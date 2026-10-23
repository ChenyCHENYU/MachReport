# 项目接入：把报表编排交给包内

MachReport 的常规使用侧只需要提供三项业务信息：**报表模板、取数函数、必要的字段映射**。分页、计划校验、参数元数据、按 ID 顺序合并、过期请求隔离和预览导出由包内处理。接口路径、权限和数据范围继续由业务系统决定。

## Vue：应用注册一次

```ts
import {
  defineMachReportConfig,
  defineReport,
  machReportPlugin
} from "@agile-team/mach-report/vue";
import "@agile-team/mach-report/vue/style.css";
import { outboundTemplate } from "./reports/outbound";
import { orderApi } from "./api/orders";

app.use(machReportPlugin, {
  reports: {
    outbound: defineReport({
      template: outboundTemplate,
      load: ({ params, signal }) => orderApi.report(params, { signal }),
      mapData: (data) => ({ detail: data.items })
    })
  },
  config: defineMachReportConfig({
    defaults: { pdfFontUrl: "/fonts/report.otf" }
  })
});
```

`orderApi` 为宿主自己的请求客户端，需返回业务数据并消费 `signal` 才能取消真实网络请求。`defineReport()` 推导 `load` 的返回类型供 `mapData` 使用；不会猜测 `response.data`、`result` 或其它后端包装。数据集键 `detail` 对应模板 `.list("detail", ...)`，行字段对应列的 `field`。

固定标签使用 `defineLabelReport({ template, load: ({ params, signal }) => labelApi(params, { signal }) })`，接口直接返回行数组即可。静态数据用 `rows` 替代 `load`，单个 `dataSchema` 不再套数据集名称；注册方式、取消、错误、分页预算与普通报表相同。模板与单数据集约束、真实编码和设备边界见[标签指南](./LABELS.md)。

页面只需：

```vue
<MachReportPreview
  report-id="outbound"
  :params="{ orderId }"
  height="70vh"
  @error="onReportError"
  @warning="onReportWarning"
/>
```

`report-id` 选择注册的报表定义，业务单据 ID 和查询条件放在 `params`。不需要在页面实现 `paginateTemplate`、校验器或页合并；无需手写组件 ID 分支或重复参数面板定义。

## 标准明细：只定义业务列

普通台账、订单明细无需手算坐标和宽度：

```ts
import { createTableTemplate } from "@agile-team/mach-report/vue";

export const outboundTemplate = createTableTemplate({
  title: "出库单",
  columns: [
    { header: "物料", field: "name", flex: 3 },
    { header: "数量", field: "qty", style: { align: "right" } }
  ]
});
```

默认 A4、各 10 mm 页边距、`detail` 数据集；未指定宽度的列按 `flex` 权重分配页面余量，默认权重为 1。`widthMm` 固定列优先，其余列分配剩余宽度；全部列固定时表格保持列宽之和。支持 `paper`、`landscape`、`margins`、`params`，`listOptions` 沿用重复表头、分组、小计、总计和格式化配置。非法尺寸或固定列溢出提前报错，标题默认只出现在第一页。

后续仍注册 `{ template, load }` 或 `{ template, datasets }`。多区块、签字栏或定位精确的业务单据继续使用 `createTemplate()`；两种模板消费同一数据源与分页器。

## 接口已返回数据集或使用静态数据

接口本身返回 `{ detail: [...] }` 等数据集时，直接提供 `load`：

```ts
app.use(machReportPlugin, {
  reports: {
    outbound: {
      template: outboundTemplate,
      load: ({ params, signal }) => reportApi(params, { signal })
    },
    sample: {
      template: outboundTemplate,
      datasets: { detail: [{ name: "物料 A", qty: 3 }] }
    }
  }
});
```

`load` 可同步或异步返回数据集；与 `datasets` 同时提供时优先 `load`。每次查询重新调用，不缓存业务数据、不自动重试，也不推断列表分页接口中的完整结果。普通业务数据的运行时字段校验由宿主完成；包内检查数据集容器、行对象以及生成计划的结构。

## 参数面板自动读取模板

模板可用 DSL 或 JSON 声明参数：

```ts
const template = createTemplate()
  .params([{ field: "warehouse", label: "仓库", defaultValue: "ALL" }])
  .page("a4")
  // ...文本与明细
  .build();
```

注册后，组件自动读取 `template.params`，显示查询面板并使用默认值。报表定义上的 `params` 可以替换模板参数；组件 `paramDefs` 拥有最高优先级，传 `[]` 可不采用这些面板定义。`showParams=false` 只隐藏面板，参数定义及其默认值仍生效。查询按钮验证 `required`；实际业务权限和入参约束由接口执行。

多个报表用数组传 ID：`:report-id="['outbound', 'process-card']"`。包内按数组顺序取数并拼接页面，参数定义取有序并集，同名字段使用首个报表的定义；有冲突时显式提供组件 `paramDefs`，不要依赖隐式覆盖。切换报表后面板重置为新报表默认值与宿主参数。

## 父页面控制：一个句柄

```vue
<script setup lang="ts">
import { useMachReport } from "@agile-team/mach-report/vue";

const report = useMachReport();
const { state } = report;
async function exportExcel() {
  await report.exportAs("xlsx");
}
</script>

<template>
  <button :disabled="!state.canExport" @click="exportExcel">导出 Excel</button>
  <span v-if="state.loading">正在加载报表</span>
  <MachReportPreview :ref="report.ref" report-id="outbound" :params="{ orderId }" />
</template>
```

句柄提供 `reload()`、`print()`、`exportAs()`、`openPdfWindow()`、`gotoPage()` 和 `setParams()`；按需可用 `undo()`、`redo()`、`restoreChanges()`、`focusField()`、`focusCell()`、`getSelection()`、`copySelection()` 和 `pasteSelection()`，无需页面再实现一套交互状态。`ready` 表示组件控制器已挂载，不代表数据加载完成；未挂载调用明确报 `config` 错误。组件未加载有效页面时打印和导出保持空操作。

`state` 是稳定的只读对象，支持如上解构并响应更新；读取字段无需 `.value`。在 Vue 模板或 `computed` 中读取字段即可跟踪变化，单独解构 `const { loading } = state` 只会得到当时的值。组件 ref 和后代控制器也提供只读状态。

| 字段 | 含义 |
| --- | --- |
| `loading` / `hasPlan` | 正在查询 / 已加载非空页面计划 |
| `pageCount` / `currentPage` | 总页数 / 当前页（从 1 开始） |
| `exporting` / `printing` | 异步导出的显示名称或 `null` / 正在准备打印 |
| `canExport` / `canPrint` | 已有页面且未加载，并且对应操作空闲；不代表特定出口能保留全部内容 |
| `error` | 最近一次操作错误 `{ code, message, cause? }`，新操作清空；字体预检异常单独记录 |
| `pdfFont` | 字体预检状态、URL 与诊断信息；不阻塞预览、打印或 Excel |
| `editing` / `saving` / `importing` | 当前输入、业务保存和 Excel 导入状态 |
| `dirty` / `changeCount` | 相对本次查询来源仍有净差异 / 差异单元格数；不代表数据库未保存 |
| `canUndo` / `canRedo` / `selection` | 撤销/重做是否可用，以及当前物理选区 |

卸载时句柄回到空状态。旧自定义控制器没有 `state` 时也使用空状态，旧六个方法继续可用；需要外部按钮状态的自定义控制器应实现新字段。

`reload`、`print`、`exportAs`、`setParams` 可等待；等待表示本次工作结束，生成失败仍通过现有 `error` 事件报告，不能把 Promise 成功完成视为输出成功。`openPdfWindow()` 必须在点击等用户手势中同步调用，以保留浏览器弹窗权限。

原组件 ref 和后代 `useReportPreview()` 继续可用。同一计划的 PDF、XLSX 和 PNG 重复操作共享正在执行的工作；不同输出格式的忙碌状态会正确协调。切换报表和卸载后，过期任务不再触发下载、错误或告警；正在生成的空 PDF 窗口和打印 iframe 会清理。

## 可选编辑与 Excel 模板导入

默认接入保持只读。需要本地修改和导入文件时，页面只增加两个开关：

```vue
<MachReportPreview
  :ref="report.ref"
  report-id="production"
  editable
  excel-import
  @cell-edit="onCellEdit"
  @template-import="onTemplateImport"
/>
```

单击和键盘可选择、定位及复制单元格，双击或 F2 开始编辑；开启编辑后提供原子矩形粘贴、撤销/重做、修改角标、差异审阅和恢复来源值。预览和各输出使用同一份新计划。导入 `.xlsx` 会把各 Sheet 的内容、合并、尺寸和基础样式转换为普通模板并替换当前预览，同时显示 Sheet 导航与兼容性摘要。默认 wide 保持完整列宽，A3/A4 是选配。显式 `report.importExcel(file, options)` 可用于宿主已有的上传控件，不必显示包内按钮。

业务持久化给 `editable` 提供 `{ requireSource: true, canEdit, validate, saveBatch }`；列表通过 `listOptions.rowKey`、`revisionField`、`sourceTokenField` 声明稳定业务来源，自动生成 `datasetId / rowKey / field`。包内先校验整批再保存，成功后更新计划，失败保留原值；保存函数应消费 `signal`，服务端按 `requestId` 幂等并在事务内校验版本。旧单格 `save` 仍兼容，没有原子 `saveBatch` 时不提交多格写入；撤销、重做和恢复也会调用真实保存回调。`getChanges()`、`getDifferences()` 和 `getPlan()` 返回独立快照。具体契约见[单元格编辑](./CELL_EDITING.md)。

已注册 `ReportProvider` 时，再用 `createProviderEditing(provider, { reportId: "production", params: () => executedQuery.value })` 显式连接同一保存能力即可，包内转接单格、批量、来源版本及逐格冲突。页面不需要复制 Provider 保存逻辑；查询适配器仍不会隐式开启业务写入。

导入不执行 Excel 公式、宏或外部链接，也不猜测模板与后端字段之间的关系。公式单元格使用缓存结果并保持只读，缺少缓存时空值告警。宿主继续负责模板版本、业务数据绑定、权限和审批；资源预算与转换边界见[Excel 模板导入](./EXCEL_IMPORT.md)。

### 设置、冻结与用户偏好

```ts
// 注册一次的默认配置；组件 props 可按页面覆盖。
defineMachReportConfig({ defaults: {
  interaction: { freezeHeaders: true, frozenColumns: 1 },
  toolbar: { editing: false, excelImport: false }
} });
```

设置入口默认可见，按能力启用搜索、缩略图、缩放、导出、打印、编辑及导入；宿主未授权的能力保留禁用原因。冻结仅影响屏幕，不改变 PDF、Excel 和打印尺寸。工具偏好默认实例内，用户级持久化只需可选 `preferences: { key, adapter }`，不需要页面逐项维护。完整示例与范围见[预览交互](./INTERACTION.md)。

打印默认等待独立文档的字体和图片准备完成；可选 `defaults.printOptions` 统一配置字体、资源超时和毫米偏移。业务空值解释通过查询结果的 `diagnostics.valueState / target` 声明，预览自动折叠展示并按业务主键定位。接入见[打印与来源说明](PRINT_AND_DATA.md)。设计器的恢复、共享片段与命名样例独立选配，分别见[草稿恢复](DRAFT_RECOVERY.md)和[设计效率](DESIGNER_PRODUCTIVITY.md)。

### 图片、图表与二维码适配器统一配置

已有二维码、条码或图表库时，注册生成图片的函数即可复用到预览与各视觉出口：

```ts
defineMachReportConfig({ defaults: {
  assets: {
    assetRenderers: { qrcode: ({ component, signal }) => renderQrDataUrl(component.text ?? "", { signal }) },
    assetFailure: "throw"
  }
} });
```

`renderQrDataUrl` 为应用选择的编码库适配函数，返回图片 data URL；PDF 兼容的 PNG/JPEG 最便于跨端共用。包内在加载计划后准备一次，后续预览、Canvas、PDF、PNG 使用同一份 `imageData`，不用页面包装每种导出。可配置 `assetBudget` 和 `onDiagnostic`，准备任务随报表切换取消。无配置时保留原来的占位与诊断；适配器失败默认阻止本次新计划，可显式选择 `assetFailure: "placeholder"` 并通过 `warning` 观察降级。Excel 数据出口仍有图片与几何边界，以输出支持矩阵为准。

## 不使用 Vue：同一数据源

```ts
import { createReportSource, defineReport, renderPlan } from "@agile-team/mach-report";

const source = createReportSource({
  outbound: defineReport({
    template: outboundTemplate,
    load: ({ params, signal }) => orderApi.report(params, { signal }),
    mapData: (data) => ({ detail: data.items })
  })
});
const controller = new AbortController();
const plan = await source({
  reportIds: ["outbound"],
  params: { orderId: "SO-001" },
  signal: controller.signal,
  onWarning: (message) => console.warn(message)
});
document.querySelector("#report")!.replaceChildren(renderPlan(plan, document));
```

`createReportSource` 不依赖 Vue，可在其他前端框架或 Node.js 中用于取数与排版。DOM 渲染需要浏览器；Node.js 可以将计划交给 `/pdf` 或 `/xlsx`，也可使用[统一Runtime](./SERVER.md)。参数默认值与校验在包内执行，宿主负责UI、请求客户端消费取消及资源生命周期。

## 高级接入与兼容

### 查询面板的统一校验

`params`元数据和显式`paramDefs`使用同一核心校验。必填、枚举、数字与日期范围、Unicode文本长度会在所有预览请求入口前检查，包括自动加载、手动查询、`reload()`和`setParams()`；原始`PlanFetcher`也遵循该规则。首次缺少必填值时保持中性填写提示，不发请求、不触发错误事件；点击查询后返回`param`并在字段旁显示原因、聚焦首个问题项。要自动首载，请提供必填`params`或`defaultValue`。

可选下拉提供空选项。清空不带默认值的条件会省略该参数；显式清空有默认值的条件会传空串，避免下游再次填回默认值。重置恢复默认值并清除字段提示，不自动查询。`paramInvalid / paramPrompt / paramPromptDescription / paramSelectPlaceholder / paramTextPlaceholder`可在messages中覆盖。

| 使用场景 | 入口 |
| --- | --- |
| 常规 Vue 项目 | `app.use(machReportPlugin, { reports })` |
| 页面独立的数据源 | `createReportSource(reports)`，传给组件 `fetcher` |
| 原生 JS / TS、React、Node.js | 核心 `createReportSource` 与渲染 / 导出 API |
| 后端已经返回 RenderPlan | 自定义 `PlanFetcher` |
| 旧离线 / 本地用法 | `createLocalFetcher`，继续支持且能提供模板参数元数据 |
| 首屏按需全局注册 | `/vue/async`，同一插件配置与注册语义 |

优先级为组件 `fetcher` → 插件显式 `fetcher` → 插件 `reports`。同时配置后两者时显式 fetcher 优先，reports 不参与取数。两个 Vue 应用的数据源和配置互不共享。

旧 `PlanFetcher({ reportIds, params }) → Promise<RenderPlan>` 无需修改；新增 `signal`、`onWarning` 和 `getParamDefs` 均可选。新查询及卸载会取消旧信号，旧函数忽略信号时仍由代际检查防止结果覆盖。数据源可以及时结束取消的调用，真实 HTTP 取消需要请求客户端消费该信号；同步分页无法在执行中途被抢占。

配置支持字段继承：应用 defaults → preset → 路由叠加 → 组件 props。`messages`、`theme` 和同名 preset 保留未覆盖字段。普通及异步插件均遵守 `globalComponent=false`，不会覆盖宿主已注册的同名组件。

PDF、XLSX、SQL 实现继续在独立子入口；`/vue` 重导出核心能力不会加载这些重依赖。异步插件的 `reports` 注册阶段不取数，首次查询才加载数据源实现。中文 PDF 字体需要由项目部署完整字库，示例子集仅供示例使用。

`report.checkPdfFont()` 可主动检查或重试，结果也反映在 `state.pdfFont`；取消时拒绝 `AbortError`。HEAD 结果 `available` 只表示资源可达，实际导出仍验证文件与字符覆盖；不支持 HEAD 的服务返回 `unverified`，可以继续尝试导出。完整部署说明见 [PDF 字体指南](./PDF.md)。
