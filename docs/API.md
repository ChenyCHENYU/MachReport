# MachReport API 速查

MachReport 是独立报表引擎。应用提供模板和业务数据，或直接返回 `RenderPlan`；包内统一校验、分页、预览与输出，没有内置网关地址或鉴权逻辑。

## 能力入口速查

| 入口 | 主要 API |
| --- | --- |
| 核心 | `createTableTemplate / columnsFromContract / createReportSource / createProviderReport`；参数 / 数据校验与JSON Schema；`createTemplateManager / createMemoryTemplateStore`；编辑事务、资源准备、分页与DOM/Canvas |
| `/vue` | 预览、插件、配置、控制器、`createProviderEditing`；详情见[交互](./INTERACTION.md)和[编辑](./CELL_EDITING.md) |
| `/server` | `createReportRuntime / createReportTaskQueue / ReportRuntimeError`；见[服务端](./SERVER.md) |
| `/worker`、`/server/node` | `createBrowserReportExecutor / serveReportWorker`、`createNodeReportExecutor / serveNodeReportWorker` |
| `/xlsx`、`/xlsx/node` | 导入、`bindExcelTemplate`、计划导出；Node `writeRowsToXlsx` 流式数据导出 |
| `/designer` | `ReportTemplateEditor`；见[模板属性](./DESIGNER.md) |
| `/analytics` | `createCrossTable / computeDataset / createChartComponents`；见[分析与资源](./ANALYTICS.md) |

所有代码入口提供 ESM / CJS 与对应类型声明。仅 Node 入口可引用线程 / 文件系统；普通Vue项目无需导入它们。

### 共用数据契约

`ReportDefinition.dataSchema` 按数据集名接收 `DatasetContract`。字段支持 `text / number / boolean / date / decimal`、必填、可空、枚举、数值 / 长度范围、语义与单位；`rowKey` 验证非空且唯一的业务主键。`decimal` 保留精确小数文本，数值字符串不自动转换。`dataValidation` 可配置校验预算。

`columnsFromContract(contract, overrides?)` 生成表头 / 语义，`datasetJsonSchema(contract)` 生成 JSON Schema；唯一主键、权限和事务仍需服务端执行。参数同样可由 `reportParamsJsonSchema` 导出，`validateReportParams` 返回规范字符串 `values` 与适用于Schema的 `typedValues`。必填参数在取数前验证，不再依赖后端报错。

`ReportProvider.query(context)` 返回 `{ datasets, revision?, sourceToken?, diagnostics? }`，可选 `save / export / templates`。旧 `load` 优先并继续支持。显式 `createProviderEditing` 才连接远程编辑；仅注册Provider不自动开放保存权限。

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
| `layout` | 默认 `page` 保持旧布局；`wide` 按全部列的自然宽度展开，纵向仅分段预览 |
| `columnWidthMm` | 仅 wide：自动列基准宽度，默认 30 mm；单列 flex 为其倍数 |
| `columns` | 必填非空列数组，沿用 `ListColumn` 的字段、样式与格式化；`widthMm` 可选 |
| 列 `widthMm` / `flex` | 固定毫米宽优先；page 中其余列按正权重分配余量，wide 中为基准宽度的倍数，默认 1 |
| `paper` / `landscape` | page 默认 A4，支持预设或 `{ widthMm, heightMm }`、横向；与 wide 互斥 |
| `margins` | 默认各 10 mm；字段为 `marginTopMm` / `marginBottomMm` / `marginLeftMm` / `marginRightMm` |
| `title` / `titleStyle` | 可选首页标题；默认居中、加粗、16 pt |
| `titleHeightMm` / `titleGapMm` | 标题默认占高 10 mm，距表格 4 mm；无标题不占空间 |
| `dataset` / `params` | 默认 `detail` 数据集 / 模板查询参数 |
| `listOptions` | 继承列表行高、字号、重复表头、分组、小计与总计；位置和列宽由工厂生成 |
| 列 / `listOptions.align` | `auto/left/center/right/justify`；标准明细默认 auto，真实数字居右，日期/布尔居中，文本居左 |
| 列 / `listOptions.headerAlign` | 表头独立对齐；标准明细默认 center，不随内容自动对齐 |
| 列 / `listOptions.headerStyle` | 表头独立样式，列级覆盖整表；表头字号参与真实折行与行高测量 |
| 列 `semanticRole` | auto模式中 identifier/text居左、dimension/date居中、measure居右；显式align优先 |
| `listOptions.rowKey / revisionField / sourceTokenField` | 来源字段，随生成单元格的 `source` 传递；不得使用显示行号替代 |
| `listOptions.headerGrid` | 重复多层合并表头，通常由Excel绑定生成；列数与列宽须一致 |

输入不被修改；非法尺寸、无可用空间或 page 固定列溢出同步抛错。标题只在首段显示。wide 默认以 100% 预览，横向滚动查看完整列，纵向分段保持窗口化；普通 page 沿用纸张分页与重复表头策略。自由布局继续用 `createTemplate()`。

```ts
const wideTemplate = createTableTemplate({
  layout: "wide",
  columnWidthMm: 30,
  columns: productionColumns
});
// 标准纸张模板：createTableTemplate({ paper: "a3", landscape: true, columns })。
// 宽表的 Excel 打印纸型在 xlsx.paperSize 中选配，不改变预览与数据列宽。
```

`PlanPage.layout` 标识 wide 分段；列表网格自动携带 `PlanComponent.table` 的稳定表 ID、逻辑行序、角色和列身份。`createReportSource` 合并报表时隔离表 ID，供 Excel 精确还原同一逻辑表；手工修改这些元数据需保持一致。

内容样式优先级为条件规则 → 列 `align` → 列 `style.align` → 列表 `align` → 旧默认；表头依次取列 `headerStyle`、列 `headerAlign`、列表 `headerStyle`、列表 `headerAlign`，再回退旧样式。低层 `.list()` 未声明新字段时保持兼容。数值字符串不会仅因外观而自动右对齐；显式 number/percent 格式可声明其数值呈现意图。

### 模板管理 API

`defineReportTemplate({ id, name, revision?, description?, template })` 创建版本化纯 JSON 文档；`parseReportTemplate(unknown)` 接收文件文本或接口 JSON 对象，`serializeReportTemplate(document)` 导出可持久化文本。`validateReportTemplate` / `validateReportTemplateDocument` 返回 `{ ok, errors, warnings }`；创建和解析失败抛 `ReportTemplateError`，`errors` 带字段路径。

`createTemplateRegistry(documents?)` 提供 `get/list/register/remove`，读取返回独立快照。重复 ID 默认拒绝，更新使用 `register(document, { replace: true })`。文档协议版本为 `REPORT_TEMPLATE_DOCUMENT_VERSION`，`revision` 是宿主控制的修订标识；目录不承担权限、持久化或乐观锁。

报表的 `template` 可为 `ReportTemplate` 或异步加载函数，接收 `{ reportId, params, signal }`。动态模板先校验再取业务数据，每次重新读取，无隐式缓存；自动参数面板需在定义的 `params` 中声明。静态模板保留旧行为。完整接口与后台生命周期见[模板管理扩展](./TEMPLATE_MANAGEMENT.md)。

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
| `editable` | 默认 false；true 为本地双击编辑，或 `{ canEdit, validate, save }` 配置业务权限、校验与保存 |
| `excelImport` | 默认 false；true 显示 Excel 模板导入入口，或传 `ExcelImportOptions` 设置工作表、范围与版式 |

组件事件：`loaded(pageCount)`、`error(message, { code, cause? })`、`warning(message)`、`cell-edit(edit)`、`template-import(result)`。`error` 的 `code` 可为 `param`、`fetch`、`validate`、`render`、`pdf`、`print`、`export`、`edit`、`import` 或 `config`。

组件 ref 方法：`reload()`、`print()`、`exportAs(format)`、`openPdfWindow()`、`gotoPage(page)`、`setParams(values, { reload? })`。`exportAs` 支持 `html`、`pdf`、`xlsx` / `excel`、`png` / `image`、`word` / `doc`；未知格式会报错。引擎级图片导出另支持 JPEG。

编辑和导入增加 `getPlan(): RenderPlan | null`、`getChanges(): ReportCellEdit[]` 和 `importExcel(input, options?): Promise<ExcelImportResult | null>`。前两者返回独立快照；显式 `importExcel` 不要求打开工具栏入口，失败报告 `error` 并拒绝 Promise。成功导入替换当前预览，发出 `template-import`，不调用业务写接口。导入期间旧任务被隔离，应用仍决定是否持久化模板。详见[单元格编辑](./CELL_EDITING.md)和[Excel 模板导入](./EXCEL_IMPORT.md)。

父页面推荐 `const report = useMachReport()`，模板绑定 `:ref="report.ref"`，控制方法直接从句柄调用。`ready` 是组件已挂载状态；`reload`、`print`、`exportAs`、`setParams` 可等待，但生成错误仍走 `error` 事件。PDF 窗口方法保持同步调用，保留点击事件的弹窗权限。

句柄 `state` 为只读响应式对象，字段包括 `loading`、`hasPlan`、`pageCount`、`currentPage`、`exporting`（显示名称或 `null`）、`printing`、`canExport`、`canPrint`、`error`、`pdfFont`，以及 `editing`、`saving`、`importing`、`dirty`。`dirty` 表示本次计划有成功修改，不表示后台是否已保存。`const { state } = report` 保持响应性，在模板或 `computed` 中读字段即可；无需 `.value`。`error` 含 `code`、`message`、可选 `cause`，新操作清空。旧自定义控制器可不提供新增字段和方法，新句柄为缺失状态提供 false 回退。

`checkPdfFont(): Promise<PdfFontCheckResult>` 用于主动诊断 / 重试；取消时拒绝 `AbortError`。字体状态为 `unchecked`、`checking`、`available`、`disabled`、`unverified` 或 `error`，含 `fontUrl` 和可选 `message` / `cause`。组件有有效页面且 PDF 操作显示时自动检查，诊断错误不触发普通 `error` 事件。详细状态语义、轻量检查与部署见 [PDF 字体指南](./PDF.md)。

### 配置中心

```ts
import { defineMachReportConfig } from "@agile-team/mach-report/vue";

const config = defineMachReportConfig({
  defaults: {
    gapPx: 18,
    pdfFontUrl: "/fonts/NotoSansSC-Regular.ttf",
    showParams: true,
    editable: false,
    excelImport: false,
    preview: { overscanPages: 1, searchDebounceMs: 200 },
    xlsx: { valueMode: "raw", paperSize: "auto" },
    messages: { title: "订单报表" }
  },
  presets: {
    previewOnly: { showExport: false, showPrint: false }
  }
});

app.use(machReportPlugin, { fetcher, config });
```

优先级：组件属性 > 路由级 `provideMachReportConfig(overlay)` > preset > 应用 defaults > 内置缺省。中文 PDF 使用前请部署支持所需字符的字体，并设置 `pdfFontUrl`。缺字或 PDF 页面渲染错误会阻止下载残缺文件。

`editable` 和 `excelImport` 也可在 defaults / preset / 路由叠加中配置，默认均为 false。组件可用显式 false 覆盖上层启用状态；配置对象分别对应 `ReportEditingOptions` 与 `ExcelImportOptions`。

`preview`、`xlsx`、`theme`、`messages` 均按字段继承。预览默认正文/缩略图窗口化、搜索分片与取消；`overscanPages` 范围0–10（默认1），`searchDebounceMs` 范围0–2000ms（默认200）。非有限数值回退默认，越界值收敛。窗口化不减少完整计划本身的内存或首次排版量。

## 框架无关的渲染与导出

| 入口 | 用途 |
| --- | --- |
| `@agile-team/mach-report` | 模板、报表数据源、分页、校验、不可变单元格编辑、DOM/Canvas 渲染、窗口计算 |
| `@agile-team/mach-report/pdf` | `renderPlanToPdf`、字体加载与缓存 |
| `@agile-team/mach-report/xlsx` | `renderPlanToXlsx`、`importExcelTemplate` 与相关类型 |
| `@agile-team/mach-report/sql` | 动态 SQL 编译与单 SELECT 校验工具 |

PDF 和 XLSX 子路径的发布包声明 Node.js ≥ 18；只导入需要的入口。XLSX 默认 `sheetMode: "auto"`：明确标记的 wide 列表按逻辑表还原连续 Sheet，其余页面仍每页一张。`pages` 强制逐页，`continuous` 要求完整列表元数据，不明布局明确拒绝。wide 默认 raw，其余默认 text；`valueMode` 可覆盖。raw 使用列表保存的原始数值/布尔/文本/空值及数字格式，无元数据的旧计划回退显示文本，日期对象和公式不自动转换。`paperSize` 默认 auto，普通页识别 A3/A4/A5，wide 不强制纸型；显式纸型仅设置打印，不改变列宽。它不做坐标复刻，无法导出的内容返回告警。完整例子见 [Excel 导出指南](./EXCEL.md)。Word 出口生成兼容 HTML `.doc`，不是 `.docx`。

Canvas / PNG 当前不绘制图片型组件（图片、条码、二维码、图表）；预览与各导出后端的支持范围应按实际组件验证。SQL 入口只编译 / 校验字符串，不连接数据库；业务后端仍需使用参数绑定、只读账户和查询权限控制。

## 模块联邦

需要远程加载组件时，部署 `packages/federation` 的 `remoteEntry.js`，并由宿主通过 `MACH_REPORT_FETCHER_KEY` 注入 `PlanFetcher`。公开 expose 为 `./mach-report/reportPreview`、`./mach-report/reportHtmlPreview`、`./mach-report/filePreview`；普通 Vue 项目可以直接使用 npm 的 `/vue` 入口。

## 验证

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm test:e2e
```

## 产品操作扩展

| 配置 / 控制器 | 契约 |
| --- | --- |
| `guardChanges` | 默认为true，重新查询或导入替换前保护本地输入/草稿 |
| `beforeDiscard(context)` | 返回boolean/Promise，拒绝、异常或过期决定保留内容；默认内置确认 |
| `confirmDiscard(reason?)` | 供宿主路由等离开操作复用，默认reason为leave |
| `state.pendingLocalChanges` | 未保存输入或本地净差异；区别已持久化仍可为true的dirty |
| `state.reportIds / params` | 当前实际显示的查询快照上下文 |
| `state.task / @task` | taskId、kind、stage、status、可选真实completed/total与cancellable |
| `cancelTask()` | 取消当前查询/导入/导出/打印准备，屏蔽迟到结果；不回滚业务保存 |
| `output.fidelity` | warn为默认；strict拒绝已识别的内容/样式降级 |
| `state.diagnostics / @diagnostic` | 去重的结构化提示；含稳定code及可用的格式、页、组件/单元格位置 |
| `getOutputDiagnostics(format)` | 对当前计划预检dom/canvas/pdf/xlsx，不加载导出库 |
| `editable.fields` | 字段配置record或resolver，text/number/boolean/enum/date；保持模板只读与服务端授权 |
| `focusField({ tableId?, datasetId?, field })` | 支持跨表同名字段精确定位 |

详细示例、异步确认/取消边界见[产品操作流程](./PRODUCT_WORKFLOWS.md)，字段约束见[编辑指南](./CELL_EDITING.md)。PDF/XLSX/PNG和Excel导入另支持可选signal/onProgress；Node阶段事件及Java参考接口见[服务端指南](./SERVER.md)。

## 2.9 可选设计与执行能力

| 入口 | API | 说明 |
| --- | --- | --- |
| 核心 | `paginateTemplatePages / countTemplatePages` | 真正逐页生成，支持 `maxPages/maxCells/signal/knownTotalPages` |
| 核心 | `diffReportTemplates / reviewReportTemplate` | 语义变更、字段依赖与显式样例排版检查 |
| `/designer` | `ReportTemplateEditor` | 画布、属性与按需工具，新增可选 `dataSchemas/bindingDatasets/bindingSession` |
| `/designer` | `ExcelBindingWizard / RuleEditor / TemplateReviewPanel` | 可分别集成的绑定、声明式规则及验收组件 |
| `/xlsx` | `inspectExcelWorkbook / createExcelBindingDocument / createExcelBindingSession / parseExcelBindingSession` | 工作簿元数据、业务区域编译与会话保存 |
| `/analytics` | `aggregateRows / createAggregateAccumulator / createMatrixTable / estimateMatrixTable` | 共用聚合和有预算动态矩阵，支持精确十进制 |
| `/server` | `reviewReportPublication` | 显式样例的真实PDF/XLSX输出验收，不隐式发布 |
| `/server` | `createReportJobService / ReportJobStore` | 持久任务协议、幂等、租约、取消、失败重试 |
| `/server/node` | `openFileReportJobStore / reportArtifactSha256` | 单进程文件适配器与可选输出摘要 |

详细配置见[设计器](./DESIGNER.md)、[Excel绑定](./EXCEL_BINDING.md)、[复杂报表](./COMPLEX_REPORTS.md)、[发布验收](./PUBLICATION_REVIEW.md)、[持久任务](./DURABLE_JOBS.md)。常规预览仍只需要报表ID与参数。
