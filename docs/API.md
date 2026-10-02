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

## Vue 3 预览组件

### 注册与接入

```ts
import type { RenderPlan } from "@agile-team/mach-report";
import { machReportPlugin, type PlanFetcher } from "@agile-team/mach-report/vue";
import "@agile-team/mach-report/vue/style.css";

const fetcher: PlanFetcher = async ({ reportIds, params }) => {
  const response = await fetch("/api/report-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportIds, params })
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
}) => Promise<RenderPlan>;
```

插件只注册全局组件并注入可选配置。未传插件级 `fetcher` 时，可在单个组件上用 `:fetcher` 传入；两处都没有时组件显示配置错误，不会发出隐式网络请求。

本地模板可用 `createLocalFetcher({ [reportId]: { template, datasets } })`；它与远程 `PlanFetcher` 使用同一接口。若只需要 HTTP 请求工具，可用 `createFetchRequest({ baseUrl, headers, credentials, timeoutMs })`，接口路径与返回体由项目自行处理。

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
| `paramDefs` / `showParams` | 查询条件定义与参数面板显隐 |
| `height` / `autoLoad` | 容器高度 / 挂载后是否自动加载 |
| `showExport` / `showPrint` / `showPdfWindow` | 工具栏操作显隐 |
| `gapPx` / `messages` / `preset` | 页间距、文案与配置预设 |

组件事件：`loaded(pageCount)`、`error(message, { code, cause? })`、`warning(message)`。`error` 的 `code` 可为 `param`、`fetch`、`validate`、`render`、`pdf`、`print`、`export` 或 `config`。

组件 ref 方法：`reload()`、`print()`、`exportAs(format)`、`openPdfWindow()`、`gotoPage(page)`、`setParams(values, { reload? })`。`exportAs` 支持 `html`、`pdf`、`xlsx` / `excel`、`png` / `image`、`word` / `doc`；未知格式会报错。引擎级图片导出另支持 JPEG。

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
| `@agile-team/mach-report` | 模板、分页、校验、DOM/Canvas 渲染、窗口计算 |
| `@agile-team/mach-report/pdf` | `renderPlanToPdf`、字体加载与缓存 |
| `@agile-team/mach-report/xlsx` | `renderPlanToXlsx` |
| `@agile-team/mach-report/sql` | 动态 SQL 编译与单 SELECT 校验工具 |

PDF 和 XLSX 子路径可以在 Node.js ≥ 18 中使用；只导入需要的入口。XLSX 保留表格数据与结构，不做像素级版式复制；图片/条码/图表跳过时会产生保真告警。Word 出口生成兼容 HTML `.doc`，不是 `.docx`。

## 模块联邦

需要远程加载组件时，部署 `packages/federation` 的 `remoteEntry.js`，并由宿主通过 `MACH_REPORT_FETCHER_KEY` 注入 `PlanFetcher`。公开 expose 为 `./mach-report/reportPreview`、`./mach-report/reportHtmlPreview`、`./mach-report/filePreview`；普通 Vue 项目可以直接使用 npm 的 `/vue` 入口。

## 验证

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec playwright test
```
