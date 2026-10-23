<p align="center">
  <img src="./assets/mach-report-logo.svg" alt="MachReport Paginated Report Engine" width="920" />
</p>

<p align="center">
  <strong>面向业务宽表、明细台账与工业标签的 TypeScript 报表引擎</strong><br />
  完整宽表 · Excel 模板绑定 · 工业标签 · 前后端共用契约 · 受控服务端输出
</p>

<p align="center">
  <img src="https://img.shields.io/badge/source-2.14.0-2563eb" alt="Source version 2.14.0" />
  <a href="https://www.npmjs.com/package/@agile-team/mach-report"><img src="https://img.shields.io/npm/v/@agile-team/mach-report?label=npm&color=3178c6" alt="npm version" /></a>
  <a href="https://github.com/ChenyCHENYU/MachReport/actions/workflows/ci.yml"><img src="https://github.com/ChenyCHENYU/MachReport/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-authorization%20required-dc2626" alt="Authorization required" /></a>
  <img src="https://img.shields.io/badge/core%20runtime%20dependencies-0-14b8a6" alt="Zero core runtime dependencies" />
  <img src="https://img.shields.io/badge/TypeScript-first-6366f1" alt="TypeScript first" />
</p>

<p align="center">
  <a href="#60-秒开始"><strong>快速开始</strong></a> ·
  <a href="#完整宽表与标准纸张"><strong>完整宽表</strong></a> ·
  <a href="#excel-报表能力与边界"><strong>Excel 能力</strong></a> ·
  <a href="#工业标签与材料标识">工业标签</a> ·
  <a href="#单元格编辑">单元格编辑</a> ·
  <a href="#对齐与可读性">对齐配置</a> ·
  <a href="#模板配置与管理扩展">模板管理</a> ·
  <a href="#接入项目数据">数据接入</a> ·
  <a href="#前后端共用能力">前后端复用</a> ·
  <a href="#按需加载与包边界">按需入口</a> ·
  <a href="./docs/API.md">API</a> ·
  <a href="./examples">示例</a> ·
  <a href="./LICENSING.md">授权说明</a>
</p>

---

## 为什么选择 MachReport

MachReport 把模板、数据和输出分开：用 TypeScript DSL 或 JSON 定义布局与内容，由引擎生成统一的 `RenderPlan`，再交给预览、打印或文件导出。生产日报等多列报表按完整列宽展开；出入库单、工艺卡和订单明细可选标准纸张与分页。

| 维度 | 已具备的能力 |
| --- | --- |
| 页面模型 | 毫米单位、纸张预设与自定义尺寸、页边距、横纵向、文本与表格几何 |
| 完整宽表 | 自然列宽、横向滚动、默认 100% 预览；纵向分段窗口化，Excel 自动合并连续 Sheet |
| 明细与汇总 | 自动分页、多级分组与加权小计、业务键主从明细、动态矩阵、重复页眉页脚 |
| 数据呈现 | 表头与内容独立对齐、类型自动对齐、数值 / 百分比 / 日期格式化、条件格式 |
| 预览交互 | 右下分页、分组导出菜单、内容搜索与字段目录、跨页选区、冻结窗格、Sheet 导航 |
| 内容编辑 | 默认只读；双击与批量粘贴、原子保存、编辑后重算、撤销 / 重做、恢复与变更清单 |
| Excel 导入 | 多 Sheet 会话复用、可取消预检、完整宽表、合并样式与缓存公式值转换为模板 |
| 模板配置 | 可视化画布、Excel 业务绑定向导、计算与规则、变更对比与发布验收、CAS 历史 / 回滚 |
| 工业标签 | 模板 + 行数组直接接入、逐记录字段绑定、多版相邻与份数、真实 QR / 条码、可视化设计 |
| 输出 | 浏览器打印、HTML、PDF、真正的 `.xlsx`、逐页 PNG、Word 兼容 HTML `.doc` |
| 工程接入 | 局部组件、全局插件、异步入口、分层配置、结构化错误与导出告警 |
| 引擎复用 | 共用契约与计算、逐页排版、Node Runtime / Worker、流式 Excel、可恢复持久任务 |
| 分析扩展 | 可选只读选区计算、交叉汇总、声明式计算、柱图 / 折线图基础图元与资源适配 |

数据接口、鉴权与业务规则由宿主应用决定。包内统一校验、分页、编辑事务、设计器和版本流程；宿主提供请求与存储适配器。审批和业务数据库部署按项目现有治理执行。

### 设计、验收与执行共用一套模板

| 工作 | 包内提供 | 宿主只需提供 |
| --- | --- | --- |
| 可视化设计 | 毫米画布、样例对齐、适宽 / 选区、多选对齐 / 分布、组件锁定、列宽与多层表头 | 模板文档与保存回调 |
| Excel 业务化 | 选Sheet → 标题 / 表头 / 明细 / 页尾区域 → 字段映射 → 预览，支持重开会话 | 工作簿、数据集与字段契约 |
| 计算与复杂单据 | 声明式表达式、精确十进制、多级分组、主从关系与动态矩阵 | 业务数据与口径 |
| 发布验收 | 变更分类、字段依赖检查、显式样例、服务端真实PDF/XLSX编码 | 验收样例、字体、原子CAS存储 |
| 大任务 | 逐页生成、增量编辑历史、租约 / 幂等 / 取消 / 失败重试、有界终态归档 | 调度、文件归档；多实例数据库CAS适配 |

复杂模板继续使用同一个编辑器：工具区提供跨页结构大纲、字段引用影响、片段与内容样式、命名验收样例和基线并排对照；可选草稿存储恢复未应用配置，版本冲突保留本地内容并显式核对。设计器示例 `/designer.html` 已接入这些能力，普通预览页无需引入设计器。

已准备结果可通过 `runtime.exportPrepared()` 原样交付 PDF / XLSX，无需再次取数或分页；已归档实例使用 `generation.exportInstance()`。工业标签可按原尺寸拼入 A4，自定义起始空位、间距与偏移；异步来源按块处理，等待导出归档回执后再消费下一块。打印等待独立文档的字体与图片，校准入口收在设置中。业务声明的来源空值原因默认折叠，真实零值保持显示。

接入与边界见[交付与批量标签](./docs/DELIVERY.md)、[草稿恢复](./docs/DRAFT_RECOVERY.md)、[结构与复用](./docs/DESIGNER_PRODUCTIVITY.md)、[打印及数据说明](./docs/PRINT_AND_DATA.md)。

常规预览页面的接入保持不变。稳定业务键的数据源自动维护编辑重算会话；派生列只读，保存前准备重算，成功后更新公式、条件样式与汇总，导出等待在途编辑。工作簿公式继续仅显示缓存结果。设计工具只在打开时加载；画布拖动在松手时提交一次模板事务，样例计算与验收按按钮执行。逐页生成不保留全部输出页，输入数据和分组索引仍受预算管理。

操作与边界见[设计器](./docs/DESIGNER.md)、[Excel绑定](./docs/EXCEL_BINDING.md)、[复杂报表](./docs/COMPLEX_REPORTS.md)、[发布验收](./docs/PUBLICATION_REVIEW.md)、[持久任务](./docs/DURABLE_JOBS.md)。

业务参数、设计器和服务端执行共用一套声明：查询参数支持月份、年份与日期区间；Excel 单 Sheet 可绑定多个数据集，静态邻格与后续区域随明细行数保持位置；树形节点按稳定身份排版，父级来源值与叶子汇总显式区分。可选模板库提供分类、搜索、草稿编辑、发布版查看和复制；失败可重试原操作。批量面板提供逐组校验、状态筛选、进度、取消、继续未完成及显式失败重试，保留成功回执。参数与 Excel 绑定支持就地错误反馈、问题定位和待应用提示。实例通过独立 CAS 契约保存参数、模板/数据修订与渲染快照，预览不自动保存。运行示例访问 `/platform.html`，产品分层、接入示例及暂缓的连接/IAM/调度/渠道路线见[产品能力](./docs/PRODUCT_PLATFORM.md)。


## 安装：一个包，按需入口

```bash
pnpm add @agile-team/mach-report
```

Vue 组件要求 Vue `^3.2.47`，最低补丁版已通过现代 TypeScript 严格声明与实际 SSR 验证；主题样式在应用入口引入一次。只使用引擎、PDF 或 XLSX 时，Vue 是可选的，无需导入 `/vue`。发布包声明的 Node.js 要求为 `>=18.0.0`；仓库开发环境要求见[本地开发与验证](#本地开发与验证)。

## 60 秒开始

### Vue 3：本地模板与明细

```vue
<script setup lang="ts">
import { createTableTemplate, createLocalFetcher, ReportPreview } from "@agile-team/mach-report/vue";
import "@agile-team/mach-report/vue/style.css";

const template = createTableTemplate({
  title: "产品出库单",
  columns: [
    { header: "物料", field: "name", flex: 2 },
    { header: "数量", field: "qty" }
  ]
});

const fetcher = createLocalFetcher({
  outbound: { template, datasets: { detail: [{ name: "物料 A", qty: 3 }] } }
});
</script>

<template>
  <ReportPreview report-id="outbound" :fetcher="fetcher" height="70vh" />
</template>
```

标准明细只定义标题和列：默认 A4、10 mm 页边距、`detail` 数据集、表头居中，按内容类型对齐，自动分配列宽并分页。支持固定列宽、权重、横向纸张、分组与总计；复杂单据继续使用 `createTemplate()` 自由排版。

### 完整宽表与标准纸张

同一个工厂增加 `layout: "wide"`，列数增加时表格随之展开。自动列默认每列 30 mm，`columnWidthMm` 调整统一宽度；单列 `widthMm` 优先，`flex` 是基准宽度的倍数。页面接入、接口和数据集写法保持一致。

```ts
const template = createTableTemplate({
  layout: "wide",
  title: "炼钢生产日报",
  columns: [
    { header: "日期", field: "date", widthMm: 32 },
    { header: "班组", field: "team", widthMm: 24 },
    { header: "产量", field: "output", format: { kind: "number", digits: 3 } }
    // 继续声明全部业务列，列宽不受 A3/A4 限制。
  ]
});
```

宽表默认按 100% 显示，横向滚动查看全部列；适宽和缩放仍可手动选择。内部纵向分段用于预览窗口化，Excel 默认把同一逻辑表还原为一张连续 Sheet，保留全部列、行与原始值，重复页头只写一次。

| 使用目标 | 配置 |
| --- | --- |
| 完整宽表预览 + 连续 Excel | 模板 `layout: "wide"`；导出无需额外配置 |
| 宽表的 Excel 另选打印纸型 | 应用配置 `xlsx: { paperSize: "a3" }` 或 `"a4"`，只影响打印设置 |
| 按标准纸张排版预览 / PDF / 打印 | 模板 `paper: "a3", landscape: true` 或 `paper: "a4"`，保持默认 `layout: "page"` |

`wide` 与模板的 `paper / landscape` 分别表达自然列宽和固定纸张，不同时设置。标准纸张模式保持原有余量分配；显式固定列宽超出纸张会报错。列很多时优先宽表，避免把所有列挤进一张纸的可用宽度。Excel 打印纸型不会改写工作表列宽。

### 项目接入：注册一次，页面只传 ID 和参数

模板与业务取数集中注册，分页、校验、参数面板、多报表合并及请求生命周期交给包内处理。Vue 用户从同一个 `/vue` 入口获取组件和核心能力。

```ts
import { machReportPlugin, defineReport } from "@agile-team/mach-report/vue";
import "@agile-team/mach-report/vue/style.css";

app.use(machReportPlugin, {
  reports: {
    outbound: defineReport({
      template,
      load: ({ params, signal }) => orderApi.report(params, { signal }),
      mapData: (data) => ({ detail: data.items })
    })
  }
});
```

```vue
<MachReportPreview report-id="outbound" :params="{ orderId }" height="70vh" />
```

`template` 使用上例或项目自己的模板；`orderApi` 是项目现有业务请求客户端。接口已经返回数据集时，直接写 `load: ({ params, signal }) => reportApi(params, { signal })`，无需 `defineReport` 或字段映射。静态数据使用 `{ template, datasets }`。

模板的 `params` 会自动生成查询面板，显式 `paramDefs` 可覆盖。父页面用 `useMachReport()` 获得 `ref`、可等待的控制方法和只读响应式 `state`；例如 `report.state.canExport` 直接驱动外部按钮，加载、页数、导出、打印与错误无需另建状态。完整示例及接入边界见[项目接入指南](./docs/INTEGRATION.md)。旧 `fetcher` 与 `createLocalFetcher` 继续支持。

查询面板复用同一参数契约，校验类型、范围、日期、枚举和Unicode长度。首次缺少必填条件时显示填写引导并等待查询；提交后标明具体字段并聚焦首个问题项。可选下拉能清空，中文输入法确认不会误提交。原始`fetcher + paramDefs`和编程式`setParams`同样在请求前校验；自动首载所需的必填值请通过`params`或`defaultValue`提供。

### 原生 TypeScript：生成并渲染页面

```ts
import { createTemplate, paginateTemplate, renderPlan } from "@agile-team/mach-report";

const template = createTemplate()
  .page("a4")
  .text("第一张报表", { leftMm: 20, topMm: 20, widthMm: 100, heightMm: 10 })
  .build();

const { plan, warnings } = paginateTemplate(template, {});
if (warnings.length > 0) console.warn(warnings);

// 页面中提供 <div id="report"></div>。
document.querySelector("#report")!.replaceChildren(renderPlan(plan, document));
```

`paginateTemplate` 可在客户端或服务端运行。`renderPlan` 需要 DOM；Canvas、图片与浏览器打印同样需要浏览器环境。大量页面使用页窗口或 Vue 预览组件，避免一次创建全部页面节点。

## 工业标签与材料标识

同一引擎可设计 80 × 55 mm 等自定义标签。`createLabelTemplate({ dataset, rowKey, components })` 声明尺寸和字段绑定；多版使用 `pages`，逐条记录按“份数 → 各版”相邻输出。真实零值和前导零保留，缺字段、文字溢出和超预算明确反馈。设计器提供纸张、边距、页面复制、字段与码图属性，复用毫米画布、吸附、对齐和撤销。

```ts
import { createReportSource, defineLabelReport } from "@agile-team/mach-report";

const fetcher = createReportSource({
  labels: defineLabelReport({
    template,
    load: ({ params, signal }) => materialApi.labels(params, { signal })
    // 返回记录数组即可；静态数据改为 rows: materials
  })
});
```

模板已声明的数据集由包内自动映射；可选 `dataSchema` 直接接收单个字段契约。Vue 插件的 `reports` 和 Node Runtime 共用此定义。预览底部显示记录、业务键和版面，可直接切换相邻记录，物理页分页仍在右下角。标签属性按内容、位置尺寸和编码高级项分层；撤销与重做同时恢复操作所在的版面和组件。

可选 `/codes` 提供真实 QR、Code 128 / 39、EAN-13 / 8，并统一生成 PNG 供浏览器与 Node 的预览、PDF、打印及 Excel 使用。使用侧只传模板、数据和 `assets: { assetRenderers: createCodeAssetRenderers() }`；编码器不进入核心或默认 Vue 产物。运行 `/labels.html` 体验工业标签设计与输出，详见[标签接入与设备边界](./docs/LABELS.md)。驱动中的纸张、100% 比例与扫码实样需按设备校准；多版输出不等同硬件自动双面。

批量标签在一次分页中复用相同文本与字体参数的折行结果，缓存按条数和文本量双重限制，跨请求隔离；高度、取消和总预算仍逐条检查，不因命中缓存跳过校验。

## Excel 报表能力与边界

**支持生成真正的 Excel `.xlsx` 工作簿。** Vue 工具栏提供「导出 Excel」，组件控制器支持 `exportAs("xlsx")` / `exportAs("excel")`；原生与 Node.js 可从 `/xlsx` 使用 `renderPlanToXlsx`。

```ts
import { writeFile } from "node:fs/promises";
import { renderPlanToXlsx } from "@agile-team/mach-report/xlsx";

// plan 是 paginateTemplate 或业务接口生成的 RenderPlan。
const { buffer, warnings } = await renderPlanToXlsx(plan, {
  valueMode: "raw",
  sheetName: (pageIndex) => `报表${pageIndex + 1}`
});
if (warnings.length > 0) console.warn(warnings);
await writeFile("report.xlsx", new Uint8Array(buffer));
```

| 项目 | 当前行为 |
| --- | --- |
| 工作簿结构 | 默认 `sheetMode: "auto"`：宽表按逻辑表生成连续 Sheet，普通页面仍每页一张；可显式选择 pages / continuous |
| 表格结构 | 表头、明细、小计 / 总计的渲染结果，列宽、行高、跨行 / 跨列合并 |
| 基础样式 | 字号、字体族、加粗 / 斜体 / 下划线、颜色、水平 / 垂直对齐、换行、底色与边框开关 |
| 标题文本 | 按组件顺序写入合并行；页面绝对坐标转换为工作表行流 |
| 单元格类型 | 宽表默认 raw，普通页面默认 text；可显式覆盖，raw 保留数值、布尔、文本编号、空值和汇总数值 |
| 数字格式 | `raw` 模式沿用小数位、千分位和百分比格式，不猜测文本编号的类型 |
| 非表格内容 | 图片、条码、二维码、图表、嵌套组件和无文本回退的富文本等暂不导出，跳过时返回 `warnings` |
| 版式与打印 | 普通页面自动识别 A3 / A4 / A5；宽表默认不强制纸型，可选 paperSize，工作表列宽保持完整 |
| Excel 模板导入 | `.xlsx` 转普通模板，多 Sheet、合并、尺寸、基础样式与原始值；默认完整宽表 |
| 内容修改 | 预览按需双击编辑；公式格只读且不重算，工作簿编辑器与透视表交互不在当前范围 |

列表自动保留原始值，Vue 可在配置中一次启用 `xlsx: { valueMode: "raw" }`；旧计划没有原始值时继续导出显示文本。连续导出使用包内记录的逻辑行与列身份，不按文字猜测重复表头；多报表保持独立 Sheet。显式 continuous 要求可识别的列表结构，不支持的布局会报错。日期对象、公式和自由布局仍需业务明确处理。Excel 不做 PDF 坐标复刻；可使用返回的 ExcelJS `workbook` 继续处理并重新序列化。

完整示例、类型保留策略和注意事项见 [Excel 导出指南](./docs/EXCEL.md)。

后端全量明细导出可使用 `/xlsx/node` 的 `writeRowsToXlsx(asyncRows, { columns, stream })`：直接消费异步行迭代器，逐行提交并处理背压、进度、取消与预算，避免先构造整本 `RenderPlan`。这是数据工作表出口；需要复杂打印布局时仍使用模板分页出口。

### 导入 Excel，直接生成报表

Vue 组件默认关闭导入入口，增加一个配置即可选择本机文件：

```vue
<MachReportPreview report-id="production" excel-import />
```

独立引擎或 Node.js 使用同一转换 API。导入需要支持 `DecompressionStream("deflate-raw")` 的环境，Node.js 建议使用 22+；Node.js 18 仍支持核心排版与 PDF / XLSX 导出，缺少安全解压能力时导入会明确报错：

```ts
import { importExcelTemplate } from "@agile-team/mach-report/xlsx";
import { paginateTemplate } from "@agile-team/mach-report";

const { template, warnings } = await importExcelTemplate(file);
const { plan } = paginateTemplate(template, {});
```

默认导入全部可见 Sheet，以自然列宽生成 wide 报表，也支持 `layout: "a3" / "a4"`、选择 Sheet 和范围。保留已有内容，公式使用 Excel 保存的缓存结果并保持只读；不会执行公式或推断后端字段。未支持内容通过告警报告。资源预算和接入细节见 [Excel 模板导入](./docs/EXCEL_IMPORT.md)。

业务 Excel 模板需要反复填充接口数据时，增加显式区域映射即可，包内保留标题与合并表头、剔除样例明细并生成可分页列表：

```ts
import { importExcelTemplate, bindExcelTemplate } from "@agile-team/mach-report/xlsx";

const imported = await importExcelTemplate(file);
const { template, warnings } = bindExcelTemplate(imported, [{
  sheet: "电炉日报", header: "A3:C4", detail: "A5:C5",
  columns: ["heat", "grade", "weight"], rowKey: "heat"
}]);
// 注册 template，接口返回 { detail: [...] }；映射不猜测字段或业务数据。
```

示例范围需替换为实际模板坐标。跨区域合并、明细原型合并等无法安全重复的结构明确拒绝；保留页脚时返回版式告警，详见导入指南。

## 单元格编辑

报表默认只读。需要修改时开启 `editable`，双击单元格输入，Enter 提交，Esc 取消；打印与导出使用同一份更新后的计划。

```vue
<MachReportPreview report-id="production" editable />
```

本地修改不会写入后台。持久化可配置 `{ canEdit, validate, save, saveBatch }`，或使用 `createProviderEditing` 桥接统一 Provider。包内先验证并原子保存，再更新计划；失败保留原值。已保存数据的撤销 / 重做也经过保存回调。`listOptions.rowKey` 声明稳定业务主键，修订号与来源令牌随编辑传递；屏幕行号不会被当作数据库身份。文本编号与真实 0 保留原始类型；表头、汇总和公式默认只读。详见 [编辑指南](./docs/CELL_EDITING.md)与[交互指南](./docs/INTERACTION.md)。

## 对齐与可读性

`createTableTemplate()` 提供适合业务报表的默认值，常规列无需逐个配置。表头和内容独立设置，整表配置可被单列覆盖。

| 内容 | 默认 / 建议 |
| --- | --- |
| 表头 | 标准明细默认居中；长说明列可单独居左 |
| 名称、描述、文本编号 | 居左；编码不会因长得像数字而自动变成数值 |
| 数量、金额、百分比 | 真实数字或明确指定数字格式时居右，便于比较位数 |
| 日期、班组、分类、布尔值 | 自动模式日期 / 布尔居中；列 `semanticRole: "dimension"` 使业务分类居中 |
| 统一业务要求 | `listOptions.align` / `headerAlign` 设置整表，列级配置优先 |

```ts
const template = createTableTemplate({
  columns: [
    { header: "物料名称", field: "name", flex: 2, headerAlign: "left" },
    { header: "数量", field: "qty", format: { kind: "number", digits: 3 } },
    { header: "状态", field: "status", align: "center" }
  ]
});
```

`align` 支持 `auto / left / center / right / justify`；`headerAlign` 支持四种明确对齐。`headerStyle` 可独立配置表头字体、底色与垂直对齐。条件规则只覆盖内容；旧低层模板未配置新字段时保留原有行为。DOM、Canvas、PDF 和 Excel 使用同一份解析后的样式。

## 还原一致性与宿主样式

模板的列样式、表头样式和条件规则是报表样式入口；应用主题控制预览外壳。包内隔离普通宿主表格、文本和图片 CSS，并按统一网格坐标绘制单元格，避免全局 padding、行高或边框撑破计划尺寸。列表内距、字号继承和跨单位覆盖统一处理，使用侧保持原来的模板和页面写法。

| 输出 | 验收重点与范围 |
| --- | --- |
| DOM / 浏览器打印 | 固定几何、合并格、字体继承、独立边框、普通宿主 CSS 隔离；自定义纸张保留毫米精度 |
| Canvas / PNG | 文本、表格、基础形状、真实斜线；异步等待图片解码并逐页编码，完整富文本仍有限制 |
| PDF | 网格、内距、行高、垂直对齐、字体与图片输出；缺字、裁切及不支持样式提供诊断 |
| Excel | 完整行列、原始值、合并、行高、连续表；按工作表语义输出，不复刻自由页面坐标 |

字体可用性、宿主强制 `!important` 或伪元素规则，以及不同出口本身的能力差异，仍需按业务模板验收。详细支持矩阵、真实回归与质量门禁见[质量与还原说明](./docs/QUALITY.md)。

## 模板配置与管理扩展

模板文档只保存布局与描述，可存为 JSON 文件或交给现有后台。模板 ID、名称、修订号和布局形成明确契约；查询接口、数据与鉴权继续使用项目已有能力。

```ts
import {
  defineReportTemplate, createTemplateRegistry,
  parseReportTemplate, serializeReportTemplate
} from "@agile-team/mach-report/vue";

const templates = createTemplateRegistry([
  defineReportTemplate({ id: "outbound", name: "产品出库单", revision: "1", template })
]);

// imported 是文件文本或后台返回的 JSON 对象；包内完成校验。
templates.register(parseReportTemplate(imported), { replace: true });
const json = serializeReportTemplate(templates.get("outbound")!);
```

`list / get / register / remove` 提供模板目录与独立快照；重复 ID 默认拒绝，更新显式声明替换。文档版本由 `defineReportTemplate` 自动补齐，未知版本、非法字段和非 JSON 内容会给出结构化校验错误。

远程管理只需让报表的 `template` 按需加载，页面写法保持不变：

```ts
app.use(machReportPlugin, {
  reports: {
    outbound: {
      template: async ({ reportId, signal }) =>
        parseReportTemplate(await templateApi.read(reportId, { signal })).template,
      load: ({ params, signal }) => reportApi.data(params, { signal })
    }
  }
});
```

动态模板不隐式缓存，每次重载读取当前版本；需要自动查询面板时，在报表定义中声明 `params`。包内 `createTemplateManager(store)` 统一草稿、发布、不可变历史与回滚，宿主存储器提供原子 CAS；回滚产生新修订，保留原历史。默认内存适配器适合示例，生产接入现有数据库事务。完整方案见[模板管理扩展指南](./docs/TEMPLATE_MANAGEMENT.md)。

可选 `/designer` 提供 `ReportTemplateEditor`：按“字段 / 模板 / 高级”组织，默认用可搜索目录和当前字段属性编辑宽表，名称、说明与 JSON 按需打开；支持列宽、语义、正文 / 表头对齐、批量设置和键盘导航，预览持续可见。校验和实时预览在包内完成，宿主仅传文档、预览数据和 `save(document, { expectedRevision, signal })`。`v-model` 回显保留未保存状态，保存冲突保留草稿。运行示例后访问 `/designer.html`；接入见[模板编辑器](./docs/DESIGNER.md)。

## 前后端共用能力

字段契约可以同时生成数据校验、JSON Schema 与列定义，避免前后端和模板各维护一套类型规则：

```ts
import { columnsFromContract, createTableTemplate, type DatasetContract } from "@agile-team/mach-report";

export const contract: DatasetContract = { rowKey: "heat", fields: [
  { field: "heat", label: "炉号", type: "text", semanticRole: "identifier" },
  { field: "shift", label: "班组", type: "text", semanticRole: "dimension" },
  { field: "weight", label: "钢水重量", type: "number", required: true, min: 0, unit: "kg" }
] };
export const template = createTableTemplate({
  layout: "wide", columns: columnsFromContract(contract), listOptions: { rowKey: "heat" }
});
const reports = { daily: {
  template, dataSchema: { detail: contract },
  load: ({ params, signal }) => reportApi.query(params, { signal })
} };
```

示例 `reportApi` 使用宿主已有请求客户端。定义加入 `reports` 后，必填参数在请求前校验，数据结构在分页前校验；不合法响应返回具体路径，不以空数组掩盖。字符串编号保留前导零，精确小数可声明 `decimal` 并保持文本。

Node.js 可复用同一 `reports`，无需实现另一套分页与导出：

```ts
import { createReportRuntime } from "@agile-team/mach-report/server";

const runtime = createReportRuntime({ reports, budget: { maxRows: 50_000, maxPages: 2_000 } });
const metadata = runtime.describe(); // 参数、数据 JSON Schema 与能力描述
const { bytes, contentType, diagnostics, stats } = await runtime.export({
  reportIds: ["daily"], params: { date: "2026-10-16" }, format: "xlsx"
});
```

统一 `ReportProvider` 规范 query / save / export / templates 可选能力；旧 `load/mapData/fetcher` 继续支持。Node 直接运行本包，Java 等后端可消费 JSON Schema 与 JSON 协议，通过独立 Node 服务复用引擎；npm 包不直接运行在 JVM 内。

`/worker` 与 `/server/node` 提供真实浏览器 Worker / worker_threads 适配器，运行同步分页时可硬取消；有界队列限制并发和排队。默认同步执行仅在阶段边界检查取消，不宣称阻塞期间可抢占。接入与预算详见[服务端与 Worker](./docs/SERVER.md)。

交叉汇总、声明式计算和基础柱图 / 折线图位于可选 `/analytics`。图形展开成共享基础图元；公式字符串需显式引擎适配器，不执行 `eval`，不重算导入 Excel 的公式。二维码与条码可选内置 `/codes`；其他码制与图表仍可配置 `assets.assetRenderers`，异步准备一次后供预览和导出共用，并返回缺失 / 不支持的结构化诊断。用法见[分析与资源适配](./docs/ANALYTICS.md)。

## 大报表预览与性能

正文和缩略图均按可见窗口渲染，离屏画布及时释放；页尺寸索引按计划建立一次，滚动和跳页通过二分定位。搜索按文本块分片，输入新查询、换单据或卸载会取消旧任务，命中计数按页保存，避免为每次重复文字创建一个记录。

默认已启用，无需额外接入代码。需要调节时，统一放入配置中心：

```ts
defineMachReportConfig({
  defaults: {
    preview: { overscanPages: 1, searchDebounceMs: 200 },
    xlsx: { valueMode: "raw", paperSize: "auto" }
  }
});
```

`overscanPages` 默认 1、限定 0–10；`searchDebounceMs` 默认 200、限定 0–2000 ms。应用、preset 与路由按字段继承。虚拟化控制渲染节点数量；完整数据仍需内存，首次分页和整本导出仍有计算成本。大业务范围应配合后端受控取数、日期范围和合理单元格内容，完整导出不能误用列表当前页数据。

## 一份清晰的应用配置

把通用文案、主题、页间距和 PDF 字体放入配置中心；具体数据源与报表参数由实例提供。

```ts
import { defineMachReportConfig, machReportPlugin } from "@agile-team/mach-report/vue";

const config = defineMachReportConfig({
  defaults: {
    gapPx: 18,
    pdfFontUrl: "/fonts/NotoSansSC-Regular.ttf",
    xlsx: { valueMode: "raw" },
    messages: { title: "业务报表" }
  },
  presets: {
    previewOnly: { showExport: false, showPrint: false, showPdfWindow: false }
  }
});

app.use(machReportPlugin, { fetcher, config });
```

优先级为：内置值 → 应用 defaults → 命名 preset → 组件属性；路由级 `provideMachReportConfig` 会叠加应用配置。中文 PDF 需要部署覆盖所用字符的字体并配置 `pdfFontUrl`；Vue 出口遇到缺字或页面渲染错误会阻止下载。`.doc` 出口是 Word 兼容的 HTML 文档，并非 `.docx`。

自定义 PDF 字体完整嵌入提供的字体文件，保留中文字符的字形映射；`pdfFontUrl` 可指向完整字体的 `.gz` 静态资源以减少首次下载量，解压后的字节仍受预算与校验保护。使用完整字库时，PDF 体积会相应增加。

### 设置入口与零数据反馈

预览默认采用浅色阅读界面：分页与跳页位于右下方，导出格式收在一个菜单，搜索、字段目录和缩放各自成组。空态插图使用淡蓝强调色，可通过 `theme.emptyAccent` 覆盖；主题只影响预览外壳，不改写模板与导出样式。

「设置」分为常规、工具和高级三页：常规放冻结窗格及宿主的版式配置，工具控制阅读、输出与已授权的数据操作，高级提供可选选区计算。页面仍只传报表与业务参数，不用组装分页器、搜索框或设置面板。默认工具偏好仅在当前实例，可显式提供 `preferences` 存储适配器；交互开关在本实例内调整。设置支持方向键切页、焦点约束和 Esc 关闭，无额外 UI 组件库依赖。

Ctrl/Cmd+F 打开或聚焦内容搜索，输入时显示检索状态与命中数，Enter / Shift+Enter 切换命中，Esc 关闭并返回搜索入口。字段目录将中文列名、字段标识与章节分组放在同一弹层，↑ / ↓ 选择、Enter 定位、Esc 关闭；无匹配和超出可见结果上限都有明确提示。Tab 可跨页浏览业务格，到达首末边界后离开报表。多层合并表头和重复打印表头不会遮蔽业务行的选择坐标。编辑尚未提交时，打开设置先等待保存，失败保留原输入与焦点。

```vue
<ReportPreview
  report-id="daily"
  :toolbar="{ editing: false, excelImport: false }"
  :editable="editingOptions"
  :excel-import="true"
  :empty-state="rows.length === 0 && { title: '暂无实绩明细', description: '请核对厂别和报表日期' }"
>
  <template #settings><!-- 可放入宿主的显示版式等模板选项 --></template>
</ReportPreview>
```

`toolbar.editing` / `toolbar.excelImport` 设置初始偏好，不授予能力；对应的 `editable` / `excelImport` 仍须明确启用。旧的 `editable: true` 保持直接可编辑；需要按需开启时再设置 `toolbar.editing: false`。未接 `save` 的修改为本地草稿；配置了回调则先保存成功再更新当前计划。关闭编辑或恢复默认前会提交当前输入，校验失败保持编辑器；已确认修改不会因开关消失。Excel 导入生成本地预览，原有业务数据的持久化和权限仍由宿主负责。

| 配置 | 行为 |
| --- | --- |
| `showSettings: false` | 隐藏设置入口，保留原有工具与控制器 API |
| `interaction: { calculations: true }` | 默认启用只读选区计算；省略时关闭，也可由用户在设置的高级页开启 |
| `theme: { emptyAccent: "#79a7e8" }` | 覆盖空态插图强调色，默认淡蓝 |
| `toolbar: { search: false, thumbnails: false, zoom: false }` | 限制对应阅读工具；设置不能绕过宿主限制 |
| `toolbar: { exportFormats: ['xlsx', 'pdf'] }` | 仅提供指定出口；省略时提供全部现有格式 |
| `showExport` / `showPrint` / `showPdfWindow` | 保持原有能力上限；设为 `false` 的工具无法在设置中启用 |
| `emptyState: true` 或 `{ title, description }` | 有表头、业务行为空时在可见视口内显示 SVG 空态，保留表头；不改变计划或导出内容 |
| `@preferences-change` | 获得当前实际启用的工具状态，用于宿主联动；不需要自行维护设置面板 |

组件不会根据空白单元格猜测是否无业务数据。由宿主依据成功查询的真实行数传入 `emptyState`；导入本地模板、改变数据来源后应同步更新这一业务状态。导入、编辑后的原生导出均使用当前预览计划。

有效报表显示后，组件对已启用的 PDF 出口自动做轻量 HEAD 字体检查，不下载字库或加载 PDF 引擎。结果通过 `state.pdfFont` 提供，资源异常显示可重试提示；实际导出再验证字体文件及文字覆盖范围。部署、跨域与缓存处理见 [PDF 字体指南](./docs/PDF.md)。

### 可选的只读选区计算

只需一个配置开关；不必开启编辑，也不需要接保存回调：

```vue
<MachReportPreview report-id="daily" :params="query" :interaction="{ calculations: true }" />
```

关闭设置，单击起点后用 Shift + 单击或 Shift + 方向键选择数据，再从底部「选区计算」进入高级页。可选求和、平均值、最小值、最大值、数值计数与中位数，或输入 `SUM / COUNT` 等受控摘要表达式；点击「计算选区」才运行，选择过程不会反复重算。取消、切换选区或报表、关闭能力会隔离在途任务与旧结果。

仅原始 `number` 参与；文本编号、数字字符串、日期、布尔和空值排除，真实 `0` 保留。合并格只计一次，同一逻辑表跨页去重，重复表头和结构汇总不叠加。计算采用浮点数，展示小数位不改变源值；应选择单位与量纲一致的数据，不安全整数、除零、溢出和超限均返回诊断。结果仅用于本地分析，不落库、不修改 KPI，也不执行或重算 Excel 原公式。

默认选区最多 100,000 格、扫描预算 200,000，扫描与中位数排序分批让出执行并支持取消。组合公式仅接受摘要名、有限数值、四则运算与括号，限制为 256 字符、64 个 token、16 层深度；不会执行脚本、单元格引用或任意函数。详细操作与边界见[预览交互](./docs/INTERACTION.md)。

## 完整的日常操作流程

普通页面继续只传报表 ID 和参数。包内默认保护尚未保存的输入与本地草稿；重新查询、导入替换前提供确认，保留焦点与原内容。`state.pendingLocalChanges` 与已保存的净差异 `state.dirty` 分开，已落库的改动不会反复触发丢弃提示。路由离开可复用 `await report.confirmDiscard("leave")`，宿主已有确认组件可通过 `beforeDiscard` 接入。

查询、校验、排版、资源准备、文件生成提供阶段反馈和取消；PDF / Excel / 图片及 HTML / Word 输出报告真实完成单位，无法估算的编码过程不显示虚假百分比。`report.cancelTask()` 与 `state.task` 复用同一状态；忽略取消的自定义接口或导出器也不能用迟到结果覆盖当前报表。

宽表字段目录直接读取模板中的中文列名、多层表头与数据集，支持搜索和跨表精确定位。可选设计器把当前字段的内容、格式与编辑开关集中在首屏，字段目录按需展开并支持搜索、批量对齐与键盘导航；模板信息与高级 JSON 各有独立分区，保留撤销重做和草稿保护，无需使用方再维护一份列目录。

大宽表适宽时优先挂载当前页和定位目标，其余页面按帧补齐并显示加载占位；切换或卸载取消旧调度。选区只更新变化的属性，减少大量单元格的属性读写。导出仍使用完整计划，使用方无需维护渲染调度。

```ts
// 在集中配置中声明业务字段能力，页面无需维护编辑器。
defineMachReportConfig({ defaults: {
  editable: {
    fields: {
      weight: { type: "number", label: "净重", unit: "kg", min: 0, precision: 3 },
      shift: { type: "enum", options: [{ value: "A", label: "甲班" }, { value: "B", label: "乙班" }] }
    },
    save: saveReportCell // 使用项目已有保存方法；持久化批量编辑另提供原子 saveBatch。
  },
  output: { fidelity: "strict" } // 已知内容降级时拒绝文件，可在面板查看位置。
} });
```

编辑器类型必须与模板的值类型一致；枚举保留原始业务值。公式、受保护格和导入日期不被字段配置解除只读。输出兼容提示支持搜索与定位；默认 `warn` 保留告警并输出，`strict` 拒绝已识别的内容或样式降级。各阅读器、字体与复杂模板仍按实际文件验收。

运行示例后访问 `/product.html`，可体验复杂宽表、A3/A4、类型编辑与诊断；该页面使用明确标识的本地合成数据。

详细流程与取消边界见[产品操作指南](./docs/PRODUCT_WORKFLOWS.md)。需要复用 Java 后端认证与取数时，可直接运行[Java → Node 参考项目](./examples/server-java-node)，避免各项目重复拼接 HTTP、精度和下载处理。

## 接入项目数据

**后端可以只提供业务数据。** 宿主定义模板和取数函数，通过插件 `reports` 或核心 `createReportSource()` 注册；包内自动生成用于预览、打印和导出的 `RenderPlan`。后端无需安装 MachReport，也不必实现专用报表服务；模板也可以由后端存储后返回。

| 接入模式 | 后端返回 | 前端负责 |
| --- | --- | --- |
| 业务数据模式（常规项目优先） | 业务 JSON，如单据明细、查询结果 | 宿主提供模板、取数及字段映射；包内分页、校验、预览和导出 |
| 渲染计划模式 | 符合协议的 `RenderPlan` JSON | 宿主提供 fetcher；组件校验、预览和导出 |

内核、PDF 和 XLSX 出口不依赖前端框架；**现成的 `ReportPreview`、工具栏和参数面板依赖 Vue 3**。React、Angular 或原生 JavaScript 项目可调用核心 DOM / Canvas API 和导出 API，自行封装界面与生命周期。框架无关不代表各框架都已有预览组件。

常规业务接入使用上方的 `reports`，无需手写 `PlanFetcher` 或调用分页器。业务数据模式的完整示例见[项目接入指南](./docs/INTEGRATION.md)。接口路径、请求库、鉴权和字段映射由宿主项目管理。

如果已有接口直接返回渲染计划：

```ts
import type { RenderPlan, PlanFetcher } from "@agile-team/mach-report/vue";

const fetcher: PlanFetcher = async ({ reportIds, params, signal }) => {
  const response = await fetch("/api/report-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportIds, params }),
    signal
  });
  if (!response.ok) throw new Error(`报表加载失败：HTTP ${response.status}`);
  return (await response.json()) as RenderPlan; // 预览组件负责计划校验
};
```

`/api/report-plan` 是示例路径，请替换为实际接口。`PlanFetcher` 是高级逃生口，返回 `RenderPlan`，并可接收 `signal` 和 `onWarning`；旧函数可忽略新增可选参数。`report-id` 选择报表定义，业务单据 ID 放在 `params` 中。模板参数随 `reports` 自动传递，原始计划接口则可通过 `paramDefs` 声明查询面板。

```text
模板 + 数据 ── paginateTemplate ──┐
                                  ├─ RenderPlan ─┬─ Vue / DOM / Canvas
项目数据接口 ── PlanFetcher ──────┘              ├─ 浏览器打印 / HTML
                                                 └─ PDF / XLSX / 图片 / Word 兼容文档
```

## 按需加载与包边界

| 入口 | 用途 |
| --- | --- |
| `@agile-team/mach-report` | 模板 DSL、模板文档 / 目录、报表数据源、分页、格式化、计划校验、DOM / Canvas、页窗口计算 |
| `@agile-team/mach-report/vue` | 重导出核心 API；Vue 组件、插件、配置中心、适配器和父页面控制句柄 |
| `@agile-team/mach-report/vue/async` | 异步全局组件插件与 `preloadMachReport` 预取 |
| `@agile-team/mach-report/vue/style.css` | Vue 预览样式 |
| `@agile-team/mach-report/pdf` | `renderPlanToPdf`、字体加载与缓存 |
| `@agile-team/mach-report/xlsx` | `renderPlanToXlsx`、工作簿与导出告警 |
| `@agile-team/mach-report/sql` | 动态 SQL 编译与单 SELECT 校验工具 |
| `@agile-team/mach-report/server` | Runtime、预算、持久任务协议、真实输出发布验收与共用导出 |
| `@agile-team/mach-report/worker` | 浏览器 Worker 执行与消息桥接 |
| `@agile-team/mach-report/server/node` | Node worker_threads、单进程持久任务文件适配、文件摘要 |
| `@agile-team/mach-report/xlsx/node` | AsyncIterable 行数据流式输出，仅 Node |
| `@agile-team/mach-report/designer` | 可选 Vue 画布、属性、Excel绑定向导、规则与验收面板 |
| `@agile-team/mach-report/analytics` | 交叉表、受控计算、柱图 / 折线图基础图元 |
| `@agile-team/mach-report/codes` | 可选跨浏览器 / Node 的 QR、条码编码、物理尺寸与静区校验 |

内核保持零运行时依赖；ExcelJS、pdf-lib / fontkit、SQL parser 分别内联于对应构建入口。导入 `/xlsx` 才使用 Excel 能力，导入 `/pdf` 才使用 PDF 能力；Vue 不进入引擎主入口。npm 构建提供 ESM、CommonJS 与类型声明。

XLSX 的完整 Workbook 类型随声明打包，`@types/node` 为其 stream API 提供类型。Node I/O 独立构建，浏览器入口不引入 worker_threads 或文件系统。Canvas / PNG 的图片输出使用异步 API，遇到资源失败默认阻止不完整文件；对输出保真度敏感时仍需按具体模板验收。

需要远程加载组件的项目，可部署 `packages/federation`，参考[模块联邦示例](./examples/fed-host)。普通 Vue 项目直接使用 npm 子入口。

## 本地开发与验证

仓库开发要求 Node.js `>=22.13.0`、pnpm `11.8.0`。运行以下命令建立本地质量基线：

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm test:e2e
```

| 命令 | 用途 |
| --- | --- |
| `pnpm typecheck` | TypeScript 项目与 Vue SFC 类型检查 |
| `pnpm lint` | ESLint 检查 |
| `pnpm test` / `pnpm test:coverage` | Vitest 单元测试 / 覆盖率 |
| `pnpm build` | 引擎、Vue、联邦与示例构建 |
| `pnpm verify` | 类型、Lint、复杂度、构建、覆盖率、文档与打包消费端校验 |
| `pnpm check:quality` | 生产 TS / Vue 函数圈复杂度上限 20，输出可复核统计 |
| `pnpm check:consumer` | npm 产物在隔离目录的 ESM / CJS 运行与类型验证 |
| `pnpm test:e2e` | Playwright 浏览器端到端验证 |
| `pnpm check:compat` | 实际包的严格 ESM/CJS 类型、运行、SSR 与输出兼容检查 |
| `pnpm check:server-example` | Java→Node 真实 HTTP、精度、错误、取消、下载与混合并发 |
| `pnpm --filter @agile-team/example-minimal dev` | 启动本地报表示例 |

CI 使用同一套校验命令，并在构建后检查实际发布产物。协作边界、Changesets 与发布流程见 [AGENTS.md](./AGENTS.md)。

最小示例已包含覆盖示例字符的中文 PDF 字体子集，来源和 OFL 授权见[字体说明](./examples/minimal/public/fonts/README.md)。生产报表请配置覆盖实际数据的完整字体。

## 文档地图

| 目标 | 入口 |
| --- | --- |
| 接入与 API | [API 速查](./docs/API.md)：数据模型、模板、Vue 属性 / 事件、配置与导出 |
| Excel | [导出指南](./docs/EXCEL.md)与[模板导入](./docs/EXCEL_IMPORT.md)：原始类型、宽表与工作簿转换 |
| 单元格编辑 | [编辑指南](./docs/CELL_EDITING.md)：开关、类型、权限校验、异步保存与输出同步 |
| 交互配置 | [交互指南](./docs/INTERACTION.md)：选区、键盘、冻结、导航、偏好与导入摘要 |
| 产品工作流 | [能力与后端边界](./docs/PRODUCT_PLATFORM.md) · [批量生成](./docs/BATCH_GENERATION.md) |
| 模板管理 | [扩展指南](./docs/TEMPLATE_MANAGEMENT.md)：JSON 文档、目录、动态版本与后台接入 |
| 模板属性 | [编辑器指南](./docs/DESIGNER.md)：实时预览、版本保存与属性面板 |
| 设计效率 | [结构、片段与验收](./docs/DESIGNER_PRODUCTIVITY.md) · [草稿恢复与版本冲突](./docs/DRAFT_RECOVERY.md) |
| 输出交付 | [准备结果与标签分批](./docs/DELIVERY.md) · [打印校准与来源说明](./docs/PRINT_AND_DATA.md) |
| Excel业务绑定 | [绑定向导](./docs/EXCEL_BINDING.md)：区域识别、契约映射与可重开会话 |
| 复杂报表 | [计算与布局](./docs/COMPLEX_REPORTS.md)：精确数值、多级分组、主从、动态矩阵与逐页生成 |
| 发布验收 | [变更与输出](./docs/PUBLICATION_REVIEW.md)：兼容检查、样例和真实文件验收 |
| 持久任务 | [任务恢复](./docs/DURABLE_JOBS.md)：幂等、租约、取消与存储适配 |
| 服务端 | [Runtime / Worker](./docs/SERVER.md)：统一契约、受控执行、流式输出 |
| 分析扩展 | [分析与资源](./docs/ANALYTICS.md)：交叉表、计算、基础图表与资源适配 |
| PDF | [字体与导出指南](./docs/PDF.md)：首次诊断、字库部署、缺字与缓存 |
| 本地报表 | [最小示例](./examples/minimal)：出库单、工艺卡、多页与多模板预览 |
| 远程组件 | [模块联邦示例](./examples/fed-host) · [部署包](./packages/federation) |
| 排版与字体 | [字体测量与校准](./docs/font-calibration.md) |
| 日常操作与异常恢复 | [产品操作指南](./docs/PRODUCT_WORKFLOWS.md)：修改保护、长任务、严格输出与路由接入 |
| 工程质量与还原 | [质量与还原说明](./docs/QUALITY.md)：复杂度、宿主样式隔离、输出支持矩阵 |
| 源码分层 | [架构说明](./docs/ARCHITECTURE.md)：目录职责、hooks、适配器与性能边界 |
| 版本记录 | [Changelog](./packages/mach-report/CHANGELOG.md) |
| 工程协作 | [AGENTS.md](./AGENTS.md) |
| 产品演进 | [项目评审与优化优先级](./docs/PROJECT_REVIEW.md) |
| 使用授权 | [许可证](./LICENSE) · [授权说明](./LICENSING.md) |

## 版本与授权

当前源码版本为 `2.14.0`，以 [`packages/mach-report/package.json`](./packages/mach-report/package.json) 为准；npm 已发布版本由顶部 npm 标识展示。

Copyright © 2026 ChenyCHENYU (Agile Team). All rights reserved.

MachReport 采用 [MachReport Source-Available License 1.0](./LICENSE)。源码公开可供查看，使用、运行、测试、修改、集成、部署、分发或商业使用须事先取得作者书面授权。申请流程见[授权说明](./LICENSING.md)。

问题与建议请通过 [GitHub Issues](https://github.com/ChenyCHENYU/MachReport/issues) 提交。
