# 工业标签：设计、数据绑定与打印

MachReport 的固定标签与宽表共用模板、渲染计划、数据来源和输出管线。适用于物料标签、包装标识、工艺卡、合格证及相邻的正反两版。标签示例运行后访问 `/labels.html`。

## 最少接入

```ts
import { createLabelTemplate, createReportSource } from "@agile-team/mach-report";
import { createCodeAssetRenderers } from "@agile-team/mach-report/codes";

const template = createLabelTemplate({
  dataset: "materials", rowKey: "id", // 默认 80 × 55 mm、0 页边距
  components: [
    { kind: "text", leftMm: 4, topMm: 4, widthMm: 50, heightMm: 6,
      binding: { field: "grade" }, style: { fontSize: 12 } },
    { kind: "qrcode", leftMm: 50, topMm: 18, widthMm: 25, heightMm: 25,
      binding: { field: "id" }, code: { errorCorrection: "M" } }
  ]
});
const fetcher = createReportSource({
  label: { template, load: async ({ signal }) => ({
    materials: await loadMaterials(signal) // 宿主自己的请求函数，返回记录数组
  }) }
});
const assets = { assetRenderers: createCodeAssetRenderers({ dpi: 203 }) };
```

Vue 使用 `<ReportPreview report-id="label" :fetcher="fetcher" :assets="assets" />`。设计器使用 `<ReportTemplateEditor v-model="document" :datasets="samples" :preview="{ assets }" />`，其中 `document` 用 `defineReportTemplate` 包装模板。中文 PDF 仍需通过 `pdfFontUrl` 提供具有相应字形的字体。字体、编码图和业务请求各有独立错误提示。

无需引用 `/codes` 的场景不会加载编码引擎；默认核心和 Vue 入口不包含它。需要其他码制时仍可通过 `assetRenderers` 注入受信编码器。

## 绑定规则

| 组件 | 绑定结果 |
| --- | --- |
| `text` | 当前记录字段 → 统一格式化后的文本 |
| `image` | 当前字段 → PNG/JPEG base64 data URL；空值不输出图片 |
| `qrcode` / `barcode` | 当前字段 → `code.value` → 真实 PNG 码图 |

`binding: { field, format?, prefix?, suffix?, emptyText? }` 使用列表相同的声明式数值、日期等格式。`null`、`undefined` 和空字符串使用 `emptyText`；真实 `0`、`false` 和字符串前导零保留。格式化只影响输出，不修改输入记录。

字段名按记录的自有属性读取，`a.b` 是字面字段名，不是任意路径。不执行 JavaScript、访问器或字符串表达式。缺字段、对象值或非有限数字明确失败；应先在宿主数据映射中整理成标量。图片 URL 需通过宿主受控加载器转为 PNG/JPEG，不在模板中自动发起网络请求。

静态码图可直接配置 `code.value`，旧模板的 `fallbackText` 继续兼容。动态绑定必须声明模板级 `repeat`，避免一个模板误读另一条物料。

## 多版、份数与预算

```ts
const template = createLabelTemplate({
  dataset: "materials", rowKey: "id", widthMm: 80, heightMm: 55,
  copies: { field: "copies" }, // 也可为固定整数，默认 1
  pages: [
    { meta: { title: "产品标识" }, components: front },
    { meta: { title: "仓储识别" }, components: back }
  ]
});
```

输出顺序是 **记录 → 份数 → 模板页**，所以同一物料的一份正反两版相邻。页元数据保留数据集、行索引、稳定行键和副本索引，便于审计与追溯。原始模板和记录保持不变。空数据生成零页，不生成一张空白产品标签。

每条份数必须是 1–1000 的整数；字段份数要求数字，字符串不会静默转数值。声明 `rowKey` 时检查键存在和唯一。默认限制 10000 个物理页，分页的 `maxPages` 可显式调整；记录展开在分配页面前检查预算，支持 `AbortSignal`。组件、网格行、全部槽位（含 `null`）及嵌套组件按展开后的总成本限制为 250000，避免固定网格绕过内存护栏；大量打印建议分批，使用逐页生成或既有服务端任务管线。

`repeat` 面向固定纸张：不混用 `list`、动态 `flow` 或 `wide`。长明细、分组和宽表继续使用既有报表布局；独立的固定标签可引用其业务标识。绑定文字按统一测量器换行，放不下会指出记录与模板位置，不能靠裁切隐藏错误。

## 编码与实际输出

`/codes` 内置 QR、Code 128、Code 39、EAN-13 与 EAN-8。`code` 配置码制、QR 纠错等级、静区和条码可读文字。编码器校验内容、物理区域、像素预算与静区，输出带白色背景的 PNG，供 DOM、PDF、Canvas 与 Excel 复用；不会把假码作为成功结果。

QR 需正方形区域并保留静区，默认 M 纠错；内容越长，所需模块和面积越大。条码需要足够横向空间；EAN 有固定长度和校验位。不要把长 URL 强行塞进小标签，也不要叠 Logo、裁白边或使用低对比配色。PNG 的 DPI 需与目标设备匹配，最终仍要用业务扫码枪或手机实扫一张。

```ts
import { paginateTemplate, resolvePlanAssets } from "@agile-team/mach-report";
import { renderPlanToPdf } from "@agile-team/mach-report/pdf";

const { plan } = paginateTemplate(template, { materials }, { maxPages: 500 });
const resolved = await resolvePlanAssets(plan, { ...assets, signal });
const pdf = await renderPlanToPdf(resolved.plan, { customFontBytes, signal });
```

以上同样可在 Node 执行。Runtime 可在创建时配置 `createReportRuntime({ reports, assets })`，准备预览和 PDF/XLSX 导出共用资源与预算；使用 Worker 时在执行器自己的 Runtime 内配置适配器，不把函数跨线程序列化。编码器有界缓存相同载荷与配置，资源阶段另受 `assetBudget` 的数量、单图、总字节和时长限制；不同记录不会复用错误的码图。编码是有载荷与像素预算保护的同步 CPU 步骤，取消在其执行前后及资源链路生效，不能中断 JavaScript 正在执行的单次编码。批量任务应使用 Worker 或服务端。

默认每次资源准备最多生成 1000 张新码图，单图 32 MiB、总量 128 MiB、时长 30 秒；已经内嵌的 `imageData` 不算新图，编码缓存命中不抵扣新组件的资源计数。例如每物料一张 QR 加一张条码，默认单批最多 500 条物料，同时还需满足页和布局成本预算。预算可通过 `assets.assetBudget` 显式配置，优先按设备与任务拆批，不因为增大页数就自动扩大编码资源额度。

PDF 页面保留真实毫米尺寸。浏览器打印使用对应 `@page`；在驱动中选择同规格标签纸和 100% 比例，先核对偏移、裁切和扫码。插件无法绕过浏览器系统对话框来选择打印机、纸盒、静默打印或强制硬件双面。连续输出两版也不代表设备一定自动翻面。专业打印服务未来可作为宿主适配器接入。

发布验收也可设置 `reviewReportPublication(document, { fixtures, formats: ["pdf"], assets })`。严格模式只将已有对应编码器的缺图检查延后到真实资源生成，其他缺图、样式和格式降级仍会拒绝；真实编码失败不会进入归档回调。旧的 PDF/XLSX 局部资源适配选项保持兼容。

## 设计器入口

在“模板”页配置纸张预设或自定义毫米尺寸、边距、页面名称、增删和复制页面，以及逐记录数据集、业务键与份数。在“组件”页插入文本、Logo、二维码或条码，按组件类型配置内容、字段与编码属性；在画布调整几何、吸附、多选对齐、等距、层级和锁定。

纸张缩小时明确提示超界，不擅自缩小产品信息。设计画布的码占位用于布局，实际码图与绑定结果在“预览”中通过同一个编码器验证。预览不自动保存；修改通过撤销历史和模板 CAS 保存契约管理，发布版仍只读。模板、示例字段与接入应用的权限各有自己的职责。

## 验收清单

- 用两条不同记录验证值、零值、前导零、二维码和条码内容相符。
- 多版、多份按相邻顺序输出；空数据不生成标签。
- 缺字段、非法码、文字溢出、超预算及取消均明确反馈，不输出不完整标签。
- PDF MediaBox 与纸张毫米一致；用目标字体、打印机和扫码设备完成实样校准。
- 模板保存后重新打开，字段绑定、尺寸和编码选项保持不变。

参考平台说明中的尺寸、绑定和输出思路，本实现未引入其固定接口响应、数据库连接、账号权限或预览即保存行为。产品后台的数据库连接管理、企业 IAM、调度平台和机器人渠道继续列在[产品路线](./PRODUCT_PLATFORM.md)，按宿主需求独立闭环。
