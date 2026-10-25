# 数据填报、预填与业务核对

MachReport 把取数、编辑和核对接到同一份来源会话：模板声明字段和稳定行键；宿主提供取数、参考数据加载与必要的原子保存。包内维护差异审阅、候选校验、撤销、定位和取消，不要求页面再维护一张业务表。

运行 `pnpm --filter @agile-team/example-minimal dev`，打开 `http://localhost:8610/data-tools.html`。示例为本地数据与内存保存，展示参数、字段计算、预填、期间对比、数据条和图表；不连接业务数据库。

## 一个预览，按需增加数据工具

```vue
<script setup lang="ts">
import {
  ReportPreview, createReportSource, createTableTemplate,
  type ReportPrefillReviewOptions,
  type ReportDataComparisonReviewOptions,
} from '@agile-team/mach-report/vue';
import '@agile-team/mach-report/vue/style.css';

const sourceScope = 'production';
const template = createTableTemplate({
  title: '实绩核对', layout: 'wide',
  columns: [
    { field: 'id', header: '炉号', editable: false },
    { field: 'output', header: '出钢重', valueType: 'number', editable: true },
    { field: 'note', header: '说明', editable: true },
  ],
  listOptions: { rowKey: 'id' },
});
const fetcher = createReportSource({
  production: {
    sourceScope, template,
    datasets: { detail: [{ id: 'EAF-001', output: 0, note: '' }] },
  },
});
const reference = [{ rowKey: 'EAF-001', values: { output: '110.25', note: '上期复核说明' } }];
const prefill: ReportPrefillReviewOptions = {
  sourceScope, datasetId: 'detail',
  fields: [{ field: 'note', label: '说明' }],
  load: () => reference,
};
const dataComparison: ReportDataComparisonReviewOptions = {
  sourceScope, datasetId: 'detail',
  fields: [{ field: 'output', label: '出钢重', type: 'decimal', tolerance: '0.01' }],
  load: () => reference,
};
</script>

<template>
  <ReportPreview report-id="production" :fetcher="fetcher" :editable="true"
    :prefill="prefill" :data-comparison="dataComparison" height="70vh" />
</template>
```

上例是**本地草稿**，不代表业务落库。真实项目把 `datasets` 换成已有 `load({ params, signal })`，将 `load({ signal })` 接参考数据接口，再用 `editable.saveBatch` 接业务事务。配置也可放进 `defineMachReportConfig` 的 `defaults/presets`；组件 prop 优先，`false` 明确关闭。

配置参考数据 loader 后，工具栏增加一个紧凑的“数据工具”入口；预填和对比在侧栏中操作。读取由用户触发，不随每次渲染请求。结果每页最多呈现 50 项，正文使用已有报表定位。`label` 是宿主的配置元信息，面板文案仍由 `messages` 统一配置。

`sourceScope + datasetId + rowKey + field` 是业务身份，页面坐标不是业务键。上例在来源定义与两个Vue工具中使用同一个共享名称 `sourceScope`，Vue将它映射为引擎内部来源令牌；已有原始计划的精确令牌同样兼容。未声明时，仅当当前数据集恰有一个真实来源域才安全推断；多域或名称不匹配明确失败，不能用另一个来源的同名字段进行写入。没有任何当前业务来源的空报表不会推测为整期删除；确认空快照的业务比较可直接调用核心 `compareReportData`。多报表及跨租户来源应明确配置并保持隔离。

## 安全预填：先看差异，再提交事务

预填字段必须显式列入 `fields`；`sourceField` 可映射参考数据中的不同字段名。默认 `mode: 'empty'` 仅补 `null` 或空字符串，保留真实 `0`、`false`、空格及已有文本。参考值为空时跳过；公式、派生值、保护格和权限拒绝的字段不可写。

审阅分为 `matched / changed / skipped / conflict`，并解释已有值、无匹配目标、只读、来源为空、格式无效或同源镜像不一致。重复参考行键直接失败，不按数组顺序碰巧匹配。显式 `mode: 'replace'` 才能替换已有值，仍须审阅、并发校验和权限检查。

应用前再次解析当前业务身份、原值及修订/来源令牌；任何冲突拒绝整批。成功操作复用已有编辑事务、计算重排与撤销链路。有 `save` 而没有 `saveBatch` 时，多格持久化提前禁用并说明原因；不会逐格提交后声称原子成功。未开启编辑时可审阅，应用保持禁用。

核心及其他框架可使用：

```ts
import { createReportPrefill, reportPrefillInputs } from '@agile-team/mach-report';
const review = createReportPrefill(plan, {
  sourceScope: currentSourceScope, datasetId: 'detail',
  fields: [{ field: 'note', sourceField: 'previousNote' }],
  rows: [{ rowKey: 'EAF-001', values: { previousNote: '核对称重' } }],
});
// 用户核对 review.items/counts 后，再取得可提交的编辑输入。
const inputs = reportPrefillInputs(currentPlan, review, canEdit);
// Vue 内部交给已有 edit history；其他宿主沿用 createReportCellEditBatch + 来源会话事务。
```

`plan/currentPlan` 为真实计划，`currentSourceScope` 是真实 `cell.source/table.source.sourceScope` 令牌，`canEdit` 为宿主权限判定。纯核心不解释Vue配置共享名称，也不放宽来源匹配；纯函数不会保存、联网或替换整本工作簿。默认每份参考数据最多 50,000 行、256 个字段、1,000,000 个字段值/扫描格；单次预填最多 10,000 个变更。预算可下调，超限明确拒绝。可选 `maxRows/maxFields/maxCells/maxChanges` 的硬上限由 API 校验。

加载默认 15 秒超时，`timeoutMs` 为 1–120,000 ms。关闭、查询替换、配置变化及卸载会取消读取；迟到结果不能回写新预览。宿主应继续传递 `signal`，因为隔离迟到结果不能代替真实网络取消。

## 同一规则检查整行、整批和派生结果

`ReportPredicate` 组合 `all / any / not`，比较可以引用另一个字段；样式、显隐、IF 和填报校验复用同一内核。`valueType: 'decimal'` 明确使用十进制文本比较，`date` 使用真实 `YYYY-MM-DD` 日历日，不执行字符串脚本。

```ts
import type { ReportValidationRule } from '@agile-team/mach-report';
import type { ReportEditingOptions } from '@agile-team/mach-report/vue';
const rules: ReportValidationRule[] = [{
  id: 'mass-balance', dataset: 'detail', field: 'output',
  assert: { all: [
    { field: 'output', op: '>=', value: 0, valueType: 'decimal' },
    { field: 'output', op: '<=', right: { field: 'input' }, valueType: 'decimal' },
  ] },
  severity: 'error', message: '出钢重须非负，且不能超过投料重',
}];
const editable: ReportEditingOptions = {
  requireSource: true,
  validation: { rules },
  saveBatch: (batch, operation) => productionApi.saveCells(batch, operation),
};
```

`productionApi` 代表宿主已有的可信保存客户端，须消费 `operation.signal/requestId` 并在服务端重新校验。Vue 使用 `:editable="editable"`；并没有 `editing` prop。

包内先准备完整来源候选及计算结果，再执行整批规则，最后调用保存。行规则覆盖隐藏行和嵌套树子节点；树汇总按同一分页口径取叶节点，避免父级重复计数。`scope: 'dataset'` 的规则显式声明 `aggregates` 后，对汇总行断言。问题含规则、严重程度及可用的稳定来源身份；侧栏可直接定位，缺业务键时不猜屏幕行号。

`warning` 默认展示并允许保存，`warningPolicy: 'block'` 显式阻止；`error` 一律拒绝整批。默认规则上限 256、检查预算 2,000,000、问题预算 1,000；超过预算失败，不能截掉后续错误后放行。撤销、重做和恢复继续执行同一规则及保存契约。

声明式整批校验需要 `createReportSource/createReportEditSession` 保留来源会话。只拿到原始 `RenderPlan` 时不能假装已验证隐藏数据；可用 `validateBatch(batch, candidatePlan, operation)` 提供宿主的完整校验，或回到模板数据接入。

## 业务数据对比：精确、显式、不写回

`compareReportData(before, after, { fields })` 使用两份 `{ sourceScope?, datasetId, rows }`，每行是 `{ rowKey, values }`。要求同一数据集及来源域，识别新增、删除、变化和一致行；重复键、错误来源及超预算直接失败。数字键与同形文本键不同，不按行号比较。

```ts
import { compareReportData } from '@agile-team/mach-report';
const identity = { sourceScope: 'production', datasetId: 'detail' };
const result = compareReportData(
  { ...identity, rows: [{ rowKey: 'EAF-001', values: { output: '9007199254740993.001' } }] },
  { ...identity, rows: [{ rowKey: 'EAF-001', values: { output: '9007199254740993.003' } }] },
  { fields: [{ field: 'output', type: 'decimal', tolerance: '0.001' }] },
);
// differences[0].delta === '0.002'，没有先转成浮点数相减。
```

普通 `value` 字段精确比较原值，编号不会被当成数值。`decimal` 采用有界十进制运算；`tolerance` 是包含边界的绝对容差。`changeRatio = (after - before) / before`，返回未乘 100 的十进制字符串，侧栏显示百分比；`ratioDigits` 默认 12，可显式设为 0–100。零分母默认不给比率；`zeroDenominator: 'zero-if-equal'` 仅在两值同为零时给出 `0`。

缺失默认与 `0` 区分；`missing: 'empty-equivalent'` 才合并 `undefined/null/''`，`missing: 'zero'` 仅允许 decimal 字段且需业务明确同意。默认最多 20,000 条字段差异，超限拒绝而非静默省略。对比是只读分析，不生成填报补丁。Vue 当前侧从同一次渲染查询提取，不要求宿主维护第二份当前数据。比较只覆盖当前报表实际提供的字段；任一配置字段从未提供时（例如被隐藏或名称错误）明确失败，不能把缺少渲染字段误报为业务记录删除。部分行缺值仍按显式 missing 策略处理，纯核心的显式空快照比较保持可用。

## 数据条、色阶与声明图表

```ts
import type { ListColumn } from '@agile-team/mach-report';
const columns: ListColumn[] = [
  { field: 'output', header: '出钢重', visual: { kind: 'dataBar', min: 0, max: 150 } },
  { field: 'yield', header: '收得率', visual: { kind: 'colorScale', min: 0, max: 1,
    lowColor: '#f0f7ff', highColor: '#8bbcf1' } },
];
```

配置位于 `ListColumn.visual`，默认只处理真实数字；数字文本须显式 `numeric: 'decimal'`，视觉比例最终为有限浮点坐标，不作为高精度计算结果。域值按列准备并复用；声明 `min/max` 可固定跨期间尺度。空值不涂色，真实 `0` 保留，跨正负数据条以零为轴，颜色限定 `#RRGGBB`。不改变原始值、来源或可编辑性。

XLSX 保留色阶底色和原生单元格值；数据条是**静态半透明绘图快照**，不是 Excel 动态条件格式，Excel 修改值后不自动重算条形。`renderPlanToXlsx` 返回 `notes`；受控运行时以 `xlsx-snapshot` 信息诊断保留语义。`maxDataBars` 默认 10,000，可设为 0–100,000，超限拒绝，`0` 不表示静默隐藏。`/xlsx/node` 流式数据行导出不消费 RenderPlan，不复刻页面或视觉条。

声明图表放在页面组件中：

```ts
const chart = {
  kind: 'chart' as const, leftMm: 10, topMm: 90, widthMm: 180, heightMm: 65,
  chartBinding: {
    dataset: 'detail', categoryField: 'shift', type: 'bar' as const,
    measures: [{ field: 'output', op: 'sum' as const, label: '出钢重', color: '#2563eb' }],
  },
};
// template.pages[0].components.push(chart)
```

`bar / line / stackedBar / percentBar` 共用聚合内核，支持 `sum/count/avg/min/max/weightedAvg` 的显式口径。最多 100,000 来源行、200 分类、12 度量，超限明确报错；不截取前 N 项冒充完整统计。渲染前展开为统一图元，DOM、Canvas、PDF 使用相同结果。Excel 不生成原生图表对象，不能表达的非表格内容由输出诊断说明；需要图片可使用现有受控资源适配器。图表几何最小 45×35 mm，不与图片、网格、记录绑定或页眉页脚锚点混用。

设计器提供“组件 → 图表”的分类、度量与聚合向导，以及字段格式中的数据条/色阶配置；修改走已有模板事务、预览与撤销。规则编辑器可配置组合条件，并从真实函数目录选取 IF、取整、绝对值、文本和日期函数。详见[设计器](DESIGNER.md)和[分析](ANALYTICS.md)。

## Node 共用规则，宿主拥有事务

核心的 `validateReportParams`、`validateReportDataset`、`assertReportValidation`、`createReportPrefill` 和 `compareReportData` 不需要 Vue、DOM 或数据库连接。服务端从已授权的数据范围构造完整候选，复用校验后在业务事务中执行并发检查、白名单校验、写入和审计；浏览器检查不代替服务端权限。

`session.prepare(..., { validation })` 返回候选和只读问题；服务端须在保存前 `assertReportValidation(prepared.validationIssues, warningPolicy)`，通过后才调用原子保存及 `prepared.commit(result)`。不能先写库，再依赖 commit 报错回滚外部事务。

宏、任意 `eval`、导入公式完整重算、数据库连接管理、企业账号/权限控制台、审批、调度与机器人渠道继续不在通用前端内核中；后端路线见[产品平台](PRODUCT_PLATFORM.md)。本轮不更新 wl-ui-produce、不执行业务数据库或 SIT 部署；Office、打印、扫码及屏幕阅读器实机验收仍未执行。
