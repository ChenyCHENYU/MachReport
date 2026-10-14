# MachReport API 速查

MachReport 是独立报表引擎。数据来源由应用决定，组件只接收 `RenderPlan`；没有内置网关地址或鉴权逻辑。

## 核心数据模型

```ts
import {
  RENDER_PLAN_SCHEMA_VERSION,
  validateRenderPlan,
  type RenderPlan
} from "@agile-team/mach-report";

const plan: RenderPlan = {
  schemaVersion: RENDER_PLAN_SCHEMA_VERSION,
  pages: [{
    pageWidthMm: 210,
    pageHeightMm: 297,
    components: [{
      kind: "text",
      leftMm: 20,
      topMm: 20,
      widthMm: 100,
      heightMm: 10,
      text: "报表标题"
    }]
  }]
};

const result = validateRenderPlan(plan);
if (!result.ok) throw new Error(result.errors[0]?.message ?? "报表格式错误");
```

`RenderPlan.pages` 是输出页列表；页面与组件几何尺寸以毫米为单位。`schemaVersion` 由本包导出的常量提供。应用可以直接生成这个 JSON，也可以用模板分页器生成。

## 模板与数据

```ts
import { createTemplate, paginateTemplate } from "@agile-team/mach-report";

const template = createTemplate()
  .page("a4")
  .text("出库单", { leftMm: 20, topMm: 10, widthMm: 100, heightMm: 10 })
  .list("detail", { leftMm: 12, topMm: 30, widthMm: 186 }, [
    { header: "物料", field: "name", widthMm: 120 },
    { header: "数量", field: "qty", widthMm: 66 }
  ])
  .build();

const { plan, warnings } = paginateTemplate(template, {
  detail: [{ name: "物料 A", qty: 3 }]
});
```

模板支持纸张尺寸、页边距、文本、图片、表格/明细、分组小计、总计、页码、格式化和条件格式。分页告警在 `warnings` 中返回；业务侧应记录或展示有意义的告警。

### 标准明细工厂

```ts
import { createTableTemplate } from "@agile-team/mach-report";

const detailTemplate = createTableTemplate({
  title: "出库单",
  columns: [
    { header: "物料", field: "name", flex: 2 },
    { header: "数量", field: "qty" }
  ]
});
```

返回普通 `ReportTemplate`，可直接注册到 `reports` 或传给 `paginateTemplate`。

| 选项 | 行为 |
| --- | --- |
| `columns` | 必填非空列数组，沿用 `ListColumn` 的字段、样式与格式化；`widthMm` 可选 |
| 列 `widthMm` / `flex` | 固定毫米宽优先；其余列按正权重分配余量，默认 1；全部固定时保持列宽之和 |
| `paper` / `landscape` | 默认 A4，支持预设或 `{ widthMm, heightMm }`、横向 |
| `margins` | 默认各 10 mm；字段为 `marginTopMm` / `marginBottomMm` / `marginLeftMm` / `marginRightMm` |
| `title` / `titleStyle` | 可选首页标题；默认居中、加粗、16 pt |
| `titleHeightMm` / `titleGapMm` | 标题默认占高 10 mm，距表格 4 mm；无标题不占空间 |
| `dataset` / `params` | 默认 `detail` 数据集 / 模板查询参数 |
| `listOptions` | 继承列表行高、字号、重复表头、分组、小计与总计；位置和列宽由工厂生成 |

输入不被修改；非法尺寸、无可用空间或固定列溢出同步抛错。标题只在第一页显示，续页沿用表格起点与重复表头策略。自由布局继续用 `createTemplate()`。

## 后端只提供业务数据

核心分页、DOM / Canvas、PDF 和 XLSX API 不依赖 Vue；`/vue` 提供的预览、工具栏与参数面板依赖 Vue 3。其他框架可直接使用核心与导出 API，自行封装界面。

常规业务接入可以复用已有后端接口，不需要后端安装 MachReport。前端保留上例的 `template`，将后端数据映射到模板约定的 `detail` 数据集。插件一次注册，无需手写分页与 ID 分支：

```ts
import { defineReport, machReportPlugin } from "@agile-team/mach-report/vue";

app.use(machReportPlugin, {
  reports: {
    "outbound-order": defineReport({
      template,
      load: async ({ params, signal }) => {
        if (!params.orderId) throw new Error("缺少单据 ID");
        const response = await fetch(`/api/outbound/${encodeURIComponent(params.orderId)}`, { signal });
        if (!response.ok) throw new Error(`取数失败：HTTP ${response.status}`);
        return (await response.json()) as {
          items: Array<{ materialName: string; quantity: number }>;
        };
      },
      mapData: (data) => ({
        detail: data.items.map((item) => ({ name: item.materialName, qty: item.quantity }))
      })
    })
  }
});
```

组件使用 `report-id="outbound-order"`、`:params="{ orderId }"`。示例路径和响应结构由业务项目替换；实际项目复用自己的请求客户端、鉴权、业务数据校验及日志机制。这里的类型断言不承担运行时校验。

`detail` 必须与模板 `.list("detail", ...)` 一致，行中的 `name` / `qty` 必须与列的 `field` 一致。包内完成数据集容器校验、分页、计划校验和有序合并；分页告警通过组件 `warning` 事件及配置的日志通道报告。接口已返回数据集时直接注册 `{ template, load }`，静态数据使用 `{ template, datasets }`。

框架无关项目使用 `createReportSource(reports)`，获得兼容 `PlanFetcher` 的可调用数据源；`defineReport({ template, load, mapData })` 用于推导业务响应并映射数据。报表定义还支持 `params` 参数覆盖和 `pagination` 测量选项。详见[项目接入指南](./INTEGRATION.md)。

数据应覆盖所需报表范围。普通列表接口只返回当前分页时，只能生成该批数据的报表；完整导出需要后端提供完整结果或由应用完成受控取数。权限、租户隔离和数据范围仍由后端校验。模板可在前端定义，也可通过接口加载；不需要专用数据库或固定后端语言。

## Vue 3 预览组件

### 高级接口：后端返回渲染计划

常规注册使用上文的 `reports`；后端已生成 `RenderPlan` 或需要完全自定义加载时使用 `fetcher`：

```ts
import { machReportPlugin, type RenderPlan, type PlanFetcher } from "@agile-team/mach-report/vue";
import "@agile-team/mach-report/vue/style.css";

const fetcher: PlanFetcher = async ({ reportIds, params, signal }) => {
  const response = await fetch("/api/report-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportIds, params }),
    signal
  });
  if (!response.ok) throw new Error(`报表加载失败：HTTP ${response.status}`);
  return (await response.json()) as RenderPlan;
};

app.use(machReportPlugin, { fetcher });
```

`PlanFetcher` 的签名是：

```ts
type PlanFetcher = (input: {
  reportIds: string[];
  params: Record<string, string>;
  signal?: AbortSignal;
  onWarning?: (message: string) => void;
}) => Promise<RenderPlan>;
```

fetcher 可选的 `getParamDefs(reportIds)` 方法提供参数元数据，新数据源及本地适配器已实现。优先级为组件 `fetcher` → 插件显式 `fetcher` → 插件 `reports`；全部缺失时组件显示配置错误，不发出隐式网络请求。旧函数可忽略新增可选字段，保持兼容。

本地模板可用 `createLocalFetcher({ [reportId]: { template, datasets } })`；它与远程 `PlanFetcher` 使用同一接口。请求工具 `createFetchRequest({ baseUrl, headers, credentials, timeoutMs })` 支持请求 `signal`、已有查询参数合并，以及覆盖完整 JSON body 读取的超时；接口路径与返回体由项目自行处理。

```vue
<template>
  <MachReportPreview
    report-id="outbound-order"
    :params="{ id: orderId }"
    :param-defs="filters"
    height="70vh"
    @loaded="onLoaded"
    @error="onError"
    @warning="onWarning"
  />
</template>
```

| 属性 | 作用 |
| --- | --- |
| `reportId` | 报表 ID，支持字符串、逗号分隔字符串或数组；多 ID 会按顺序合并页 |
| `params` | 项目查询参数，传给 `PlanFetcher`；宿主更新时同步参数面板 |
| `fetcher` | 当前组件的数据源，优先于插件注入的数据源 |
| `paramDefs` / `showParams` | 自动使用数据源的模板参数；prop 优先，`[]` 可禁用自动面板定义；showParams 仅控制显隐 |
| `height` / `autoLoad` | 容器高度 / 自动加载；手动模式在 ID、参数或数据源变化时也取消并清理旧结果 |
| `showExport` / `showPrint` / `showPdfWindow` | 工具栏操作显隐 |
| `gapPx` / `messages` / `preset` | 页间距、文案与配置预设 |

组件事件：`loaded(pageCount)`、`error(message, { code, cause? })`、`warning(message)`。`error` 的 `code` 可为 `param`、`fetch`、`validate`、`render`、`pdf`、`print`、`export` 或 `config`。

组件 ref 方法：`reload()`、`print()`、`exportAs(format)`、`openPdfWindow()`、`gotoPage(page)`、`setParams(values, { reload? })`。`exportAs` 支持 `html`、`pdf`、`xlsx` / `excel`、`png` / `image`、`word` / `doc`；未知格式会报错。引擎级图片导出另支持 JPEG。

父页面推荐 `const report = useMachReport()`，模板绑定 `:ref="report.ref"`，控制方法直接从句柄调用。`ready` 是组件已挂载状态；`reload`、`print`、`exportAs`、`setParams` 可等待，但生成错误仍走 `error` 事件。PDF 窗口方法保持同步调用，保留点击事件的弹窗权限。

句柄 `state` 为只读响应式对象，字段包括 `loading`、`hasPlan`、`pageCount`、`currentPage`、`exporting`（显示名称或 `null`）、`printing`、`canExport`、`canPrint`、`error` 和 `pdfFont`。`const { state } = report` 保持响应性，在模板或 `computed` 中读字段即可；无需 `.value`。`error` 含 `code`、`message`、可选 `cause`，新操作清空。原组件 ref / 后代控制器也提供状态；为兼容旧自定义控制器，`MachReportController.state` 与 `checkPdfFont` 可选，而新句柄始终提供两者。

`checkPdfFont(): Promise<PdfFontCheckResult>` 用于主动诊断 / 重试；取消时拒绝 `AbortError`。字体状态为 `unchecked`、`checking`、`available`、`disabled`、`unverified` 或 `error`，含 `fontUrl` 和可选 `message` / `cause`。组件有有效页面且 PDF 操作显示时自动检查，诊断错误不触发普通 `error` 事件。详细状态语义、轻量检查与部署见 [PDF 字体指南](./PDF.md)。

### 配置中心

```ts
import { defineMachReportConfig } from "@agile-team/mach-report/vue";

const config = defineMachReportConfig({
  defaults: {
    gapPx: 18,
    pdfFontUrl: "/fonts/NotoSansSC-Regular.ttf",
    showParams: true,
    messages: { title: "订单报表" }
  },
  presets: {
    previewOnly: { showExport: false, showPrint: false }
  }
});

app.use(machReportPlugin, { fetcher, config });
```

优先级：组件属性 > 路由级 `provideMachReportConfig(overlay)` > preset > 应用 defaults > 内置缺省。中文 PDF 使用前请部署支持所需字符的字体，并设置 `pdfFontUrl`。缺字或 PDF 页面渲染错误会阻止下载残缺文件。

## 框架无关的渲染与导出

| 入口 | 用途 |
| --- | --- |
| `@agile-team/mach-report` | 模板、报表数据源、分页、校验、DOM/Canvas 渲染、窗口计算 |
| `@agile-team/mach-report/pdf` | `renderPlanToPdf`、字体加载与缓存 |
| `@agile-team/mach-report/xlsx` | `renderPlanToXlsx` |
| `@agile-team/mach-report/sql` | 动态 SQL 编译与单 SELECT 校验工具 |

PDF 和 XLSX 子路径的发布包声明 Node.js ≥ 18；只导入需要的入口。XLSX 每页输出一张 Sheet，表格值为格式化后的文本，不保留原始数值 / 日期类型或公式，也不做像素级版式复制；无法导出的内容返回告警。完整例子见 [Excel 导出指南](./EXCEL.md)。Word 出口生成兼容 HTML `.doc`，不是 `.docx`。

Canvas / PNG 当前不绘制图片型组件（图片、条码、二维码、图表）；预览与各导出后端的支持范围应按实际组件验证。SQL 入口只编译 / 校验字符串，不连接数据库；业务后端仍需使用参数绑定、只读账户和查询权限控制。

## 模块联邦

需要远程加载组件时，部署 `packages/federation` 的 `remoteEntry.js`，并由宿主通过 `MACH_REPORT_FETCHER_KEY` 注入 `PlanFetcher`。公开 expose 为 `./mach-report/reportPreview`、`./mach-report/reportHtmlPreview`、`./mach-report/filePreview`；普通 Vue 项目可以直接使用 npm 的 `/vue` 入口。

## 验证

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm test:e2e
```
