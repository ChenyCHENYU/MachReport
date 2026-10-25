# 单元格编辑

报表默认只读。Vue 预览传入 `editable` 后，双击可编辑的单元格即可输入；输入类型、计划更新、输出同步、保存失败和过期任务隔离由包内处理。

## 只需一个开关

```vue
<MachReportPreview report-id="production" :params="{ date }" editable />
```

| 操作 | 行为 |
| --- | --- |
| 双击单元格 | 打开当前值的编辑框 |
| 单击 / Shift + 单击 | 选择单元格 / 扩展矩形选区 |
| 方向键 / Shift + 方向键 | 移动焦点 / 扩展选区 |
| F2 / Enter（可编辑格） | 开始编辑 |
| Enter | 校验并提交 |
| Tab / Shift + Tab（编辑框内） | 提交后移动到下一格 / 上一格 |
| Shift + Enter | 文本内换行 |
| Esc | 取消当前输入 |
| Ctrl / Cmd + C、V | 复制选区 / 预校验后原子粘贴 |
| Ctrl / Cmd + Z、Shift + Z；Ctrl / Cmd + Y | 撤销 / 重做 |
| 移出编辑框 | 提交当前输入 |
| 打印或导出 | 先提交当前编辑，失败则停止输出 |
| 在新窗口打开 PDF | 先用 Enter 完成编辑，再点击 PDF 窗口按钮，保留浏览器用户手势 |
| 重新加载、切换报表或卸载 | 取消当前输入及在途操作，清空本次修改记录 |

`editable: true` 用于本次预览的本地修改，不会自动调用业务写接口。成功提交后，DOM、Canvas、打印、PDF 和 Excel 使用更新后的同一份 `RenderPlan`；宿主传入的原计划和数据对象不会被修改。重新查询会重新生成报表，未持久化的修改不再保留。

## 接上权限、业务校验与保存

需要业务闭环时，把开关替换为一个配置对象：

```ts
import type { ReportEditingOptions } from "@agile-team/mach-report/vue";

const editing: ReportEditingOptions = {
  canEdit: (context) => !monthFrozen.value && context.table?.columnKey === "quantity",
  validate: (edit) => {
    if (typeof edit.value !== "number" || edit.value < 0) return "数量必须为非负数";
  },
  requireSource: true,
  saveBatch: (batch, { signal, action }) => reportApi.saveCells({ ...batch, action }, { signal })
};
```

```vue
<MachReportPreview
  report-id="production"
  :editable="editing"
  @cell-edit="onCellSaved"
  @error="onReportError"
/>
```

`canEdit` 决定是否打开编辑框；`validate` 可同步或异步返回错误文字，也可抛出异常。所有粘贴格先完成类型、只读及业务校验，再调用一次 `saveBatch`，成功后才应用整批修改并逐格发出 `cell-edit`。任何一格无权限、无效或冲突，当前计划保持不变；不会跳过只读格造成数据错位。

单格接入仍兼容 `save(edit, operation)`。配置了 `save` 却没有 `saveBatch` 时，插件拒绝多格持久化，避免通过多个请求伪装原子事务；此时服务端没有收到任何保存调用。本地 `editable: true` 不需要保存回调即可原子修改多格。

保存期间不会重复提交；失败保留原计划并显示错误，用户可修正或取消。重新查询、导入其他模板或卸载会取消旧操作，即使不消费 `signal` 的保存函数晚些返回，也不会覆盖新报表。

## 按字段选择输入控件

普通 `editable: true` 继续使用兼容的文本输入。需要类型控件、单位或范围提示时，只增加 `fields`；不需要为每个格创建组件或 watcher：

```ts
const editing: ReportEditingOptions = {
  fields: {
    quantity: { type: "number", label: "净重", unit: "吨", min: 0, max: 100, precision: 3 },
    heatNo: { type: "text", label: "炉号", required: true, maxLength: 20 },
    enabled: { type: "boolean", label: "启用", trueLabel: "是", falseLabel: "否" },
    status: { type: "enum", label: "状态", options: [
      { value: "open", label: "进行中" }, { value: "done", label: "已完成" }
    ] },
    businessDate: { type: "date", label: "业务日期", min: "2026-01-01", max: "2026-12-31" }
  },
  saveBatch: (batch, { signal }) => reportApi.saveCells(batch, { signal })
};
```

字段先按 `context.source.field` 匹配，否则使用 `context.table.columnKey`。不同数据集有同名字段时，改用 `fields: (context) => ...` 返回该格配置；没有返回配置则保持原来的输入方式。单元格仍先经过模板只读规则和 `canEdit`，resolver 无法授予额外权限。

| 配置 | 行为 |
| --- | --- |
| `label` / `hint` / `unit` | 输入名称、说明与单位；说明通过 `aria-describedby` 关联，主题继承外壳变量 |
| `required` | 空字符串或 null 不允许提交；数字 `0`、布尔 `false` 有效 |
| `number.min / max / precision` | 含边界的范围、小数位上限；拒绝超限值，不自动四舍五入 |
| `text.maxLength` | 按 Unicode 码点计数；文本编号保留前导零 |
| `boolean` | 显示是/否选项，保存实际布尔值；可通过 `trueLabel / falseLabel` 改名称 |
| `enum.options` | 显示 `label`，保存实际 `value`；粘贴同样检查有效选项 |
| `date.min / max` | 显式业务日期输入，保存 `YYYY-MM-DD` 字符串，检查真实日历与范围 |

类型编辑器不改变数据模型：数字和布尔列应分别声明 `valueType: "number"`、`valueType: "boolean"`；日期使用文本业务字段。枚举值须与列的数据类型一致，选项不可重复。不匹配的类型、无效日期范围或精度配置在打开前报告明确错误；不要依赖编辑器将文本编号隐式转成数字。日期不包含时区或时间；Excel 导入日期仍只读，配置 `type: "date"` 不会解除保护。

字段规则由核心入口的 `parseReportCellFieldInput(context, value, field)` 与 `validateReportCellFieldDefinition(context, field)` 统一执行，Node 或其他框架可复用；失败抛出带 `code / field / expected` 的 `ReportCellFieldError`。Vue 单格提交、批量粘贴、撤销、重做与恢复使用同一事务校验，全部通过后才调用保存接口。浏览器校验不能替代服务端权限与业务校验。

`reportApi.saveCells` 是宿主自己的请求函数；接口路径、登录态和响应解包由宿主已有客户端负责，插件不绑定业务系统。服务端必须在一个事务中检查并保存整批，继续验证租户、可写字段、封月状态和并发版本。请求函数消费 `signal` 可终止真实请求；浏览器取消本身不能撤销服务端已完成的写入。

已经使用统一 `ReportProvider` 时，无需再写一份保存转接：

```ts
import { createProviderEditing } from "@agile-team/mach-report/vue";

const editing = createProviderEditing(productionProvider, {
  reportId: "production",
  params: () => executedQuery.value,
  canEdit: (context) => context.source?.field === "quantity"
});
```

`productionProvider.save` 收到同一 `reportId / params / requestId / edits / action / signal`，并统一返回 `{ revision, sourceToken?, conflicts?, diagnostics? }`。桥接默认 `requireSource: true`；没有 `provider.save` 会立即报告配置错误，注册 Provider 本身不会自动开启写入。`expectedRevision`、`sourceToken` 可传值或 getter；getter 优先，否则从整批一致的单元格来源推导，成功结果推进后续版本。`params` getter 应与预览正在使用的已执行查询保持一致，不能指向尚未查询的临时表单值。

Provider 冲突使用 `{ editIndex, code, message }`，`editIndex` 必须是本批补丁的有效整数索引，桥接自动定位回补丁来源并显示。接口包装须先在 Provider 内解包；桥接检查非空 `revision`、字符串 `sourceToken`、诊断与冲突结构。无效响应保留当前单元格和修改历史，明确提示“服务器可能已提交，请重新查询确认”，不能据此声称后台已回滚或直接重试写入。单格 `save` 与批量 `saveBatch` 都可由同一桥接提供。

## 稳定业务身份与并发协议

列表在模板中声明业务键即可自动生成来源身份，无需页面按行号反查：

```ts
const template = createTableTemplate({
  title: "生产明细",
  listOptions: { rowKey: "id", revisionField: "revision", sourceTokenField: "sourceToken" },
  columns: [
    { header: "炉号", field: "heatNo", editable: false },
    { header: "数量", field: "quantity", valueType: "number" }
  ]
});
// detail 行例如 { id: "HEAT-001", heatNo: "00123", quantity: 5, revision: 3 }
```

每个补丁包含可选 `source: { datasetId, rowKey, field, revision?, sourceToken? }`。静态网格也可逐格声明同名 `source`。只有显式声明业务键才生成来源，`rowIndex` 永远不会自动升级成数据库 ID；`requireSource: true` 会在保存前拒绝无来源格。

`address` 是计划物理地址，`table` 是分页/镜像定位身份，均不能代替后端主键。`saveBatch` 收到 `{ requestId, edits }`；单格 `save` 和批量回调还收到 `{ signal, requestId, action }`，其中 `action` 为 `edit`、`undo`、`redo` 或 `restore`。同一快照、相同失败操作的重试复用 `requestId`，修改内容后生成新标识；服务端应绑定该标识与确切请求内容，实现幂等重放。

```ts
// 成功：前端同步更新受影响 dataset 的并发元数据，供下一次修改使用。
return { revision: 4, sourceToken: "new-token" };

// 冲突：拒绝整批，前端保留当前值和撤销栈，展示明确冲突信息。
return { conflicts: [{
  source: { datasetId: "detail", rowKey: "HEAT-001", field: "quantity" },
  message: "此炉数据已被其他人修改，请刷新后重试",
  currentValue: 8,
  revision: 4
}] };
```

返回 `void` 仍可用于旧保存函数。业务存在并发时应返回新版本或在保存后重新查询；服务端拒绝可抛异常。`revision` / `sourceToken` 的成功结果是本批涉及数据集的统一版本，不应承载互不相关的逐行版本。

## 修改审阅、撤销与恢复

开启编辑后，预览内提供撤销、重做、修改明细与恢复来源值；修改过的格有角标，明细可点击定位。相同字段连续修改只在明细中显示相对本次来源的净差异，改回来源值后角标消失。

有持久化回调时，撤销、重做和恢复也经过相同的校验与保存协议，不能仅把前端画面改回而让数据库停留在新值。失败不会出栈，也不会假装恢复成功。单格 `save` 接入可以撤销单格；多个差异一起恢复需要 `saveBatch`。

剪贴板支持带制表符、换行和双引号的 TSV；文本编号保留前导零。一次最多 10000 格、4 MiB 文本，超出范围或越过表格边界会整批拒绝。该能力用于当前已加载快照，不会自动请求远端尚未加载的数据。

## 默认类型与只读规则

| 内容 | 默认行为 |
| --- | --- |
| 文本、文本编号 | 保持字符串；`"00123"` 不会变成数值 |
| 数值 | 解析为有限数字，保留数字格式；`0` 保持数字 0 |
| 布尔 | 按布尔值处理，不作为任意文本保存 |
| 空单元格 | 根据 `valueType` 或已有数字格式确定输入类型，否则按文本 |
| 表头、组头、小计、总计 | 默认只读，业务明确设置单元格 `editable: true` 可选开放 |
| SDK `computed` 派生单元格 | 始终只读，无业务来源；覆盖同名源字段也不开放编辑 |
| 业务稳定主键 | 模板重算事务中保持只读，避免改变后端定位身份 |
| Excel 公式单元格 | 始终只读，使用已有缓存结果，不执行 Excel 公式引擎 |
| Excel 导入的日期格 | 保留序列和显示格式，目前保持只读 |
| 带嵌套内容的复杂单元格 | 保持只读，避免文本输入破坏内部结构 |
| 单元格 `editable: false` | 始终只读，即使整个预览开启编辑 |

模板静态网格和列表列可通过 `editable` / `valueType` 声明策略。例如数量列可以用 `editable: true, valueType: "number"`，不可修改的编号列设为 `editable: false`。只读约束不能被 `canEdit` 绕过，后者仅能进一步收紧权限。

通过 `createReportSource` / `createLocalFetcher` 注册的模板与稳定 `rowKey`，由 SDK 统一执行“编辑 → 声明式计算 → 分组/总计 → 条件与行筛选 → 重新排版”。整批重算先于业务保存；重算失败不会调用保存，保存失败不发布待提交计划。撤销、重做和恢复按稳定来源定位，即使修改导致原行被 `rowVisibleWhen` 隐藏，也能安全恢复；宿主权限与字段校验仍执行。

编辑会话在私有快照内自动复用声明式计算计划，按拓扑顺序比对每行的字段依赖。首笔事务建立结果；后续修改只重新求值依赖发生变化的 `scope: 'row'` 字段，无关行和无关计算字段直接复用。分组、整表聚合保持完整列计算，其结果变化再传播到依赖字段；字符串公式适配器仍完整调用，以保留宿主读取行序号和上下文的行为。无需新增配置，也不会缓存公开 `computeDataset` 的可变输入。

每个私有数据集最多保留 16 个计算计划、1 Mi UTF-16 units 定义键和 50 万个依赖/结果标量槽位，超出缓存预算自动完整求值；COW 候选事务继承只读结果后独立写入，取消、冲突和保存失败不会发布候选计算。撤销重做沿用相同依赖检查，计算格继续只读，空值、真实零和小数精度规则保持一致。

几何排版仍按完整逐页引擎执行，以正确处理筛选、分组、排序、条件样式和行高变化；每 8 页让出执行并支持取消。单次分页内对相同文本及完整字体度量参数使用有界测量缓存（最多 4096 项、128 Ki UTF-16 定义键），不跨查询复用宿主字体测量结果。不会对每个只读预览额外执行一轮排版。模板数据在首次修改前被宿主原地改变会报告冲突，重新查询即可恢复。首笔成功后使用私有快照与 COW 更新，宿主数据和模板不受修改；来源口径指纹与首次快照最多100万个节点，首次快照最多32 MiB文本。数据应为普通数据属性（标准 Date 支持）；自定义 `toJSON`、getter、函数或 Symbol 不作为可重算来源，避免隐藏源数据变化。这里的依赖复用不等同于完整 Excel 增量公式引擎或局部几何分页。

后端 KPI、持久化规则和 Excel 原生公式继续由对应业务/公式引擎负责；SDK 不猜测后台口径。`requiresRecalculation` 是随 JSON/Worker 保留的编辑要求，不代表本地模板会话仍可用。没有稳定业务身份、直接使用 RenderPlan、或者跨 Worker/JSON 丢失会话的计算报表，预览会阻止编辑并提示改为模板接入或保存后重新查询，避免导出旧计算结果。无计算的旧计划保留原有计划内编辑行为。

## 父页面读取与批量保存

```ts
import { useMachReport } from "@agile-team/mach-report/vue";

const report = useMachReport();
const changes = report.getChanges();
const differences = report.getDifferences();
const snapshot = report.getPlan();
await report.undo();
await report.redo();
await report.restoreChanges();
```

`getChanges()` 返回本次成功操作的补丁流水，包括撤销与恢复操作；`getDifferences()` 返回相对本次来源的净差异。`getPlan()` 返回当前计划的独立快照，修改返回值不会影响预览。`cell-edit` 的参数包括 `address`、可选 `table` / `source`、`previousValue`、`previousText`、`value` 和 `text`。结构化错误通过现有 `error` 事件报告。

只读 `state` 提供 `editing`、`saving`、`importing`、`dirty`、`pendingLocalChanges`、`canUndo`、`canRedo`、`changeCount` 和 `selection`。`dirty` 表示相对本次来源仍有净差异，不代表后台是否已持久化；有保存回调时同样会记录差异。`pendingLocalChanges` 只统计实际改动的活动输入及无保存回调的本地净修改；成功调用保存接口后，差异审阅仍可保留，但不会被误判为未保存。取消输入或本地撤销回原值会清除对应待保存状态。冻结、工具偏好与字段定位见[预览交互](./INTERACTION.md)。

## 不使用 Vue

核心入口提供同一套不可变编辑操作，不加载 Vue 或 ExcelJS：

```ts
import {
  createReportCellEdit,
  applyReportCellEdit,
  createReportCellEditBatch,
  applyReportCellEditBatch
} from "@agile-team/mach-report";

const edit = createReportCellEdit(plan, {
  pageIndex: 0,
  componentIndex: 1,
  rowIndex: 0,
  columnIndex: 1
}, "0");
const updatedPlan = applyReportCellEdit(plan, edit);

const batch = createReportCellEditBatch(plan, [
  { address: { pageIndex: 0, componentIndex: 1, rowIndex: 0, columnIndex: 1 }, value: 0 }
], "request-unique-id");
const updatedBatchPlan = applyReportCellEditBatch(plan, batch);
```

合并单元格使用左上角的物理网格坐标。创建补丁会检查类型与只读规则，应用补丁会检查原值冲突；带逻辑表身份的镜像单元格同步更新。其他框架可自行提供输入界面，把同一更新计划交给渲染和导出 API。

## 其他框架的计算事务

核心会话无需 Vue。模板来源的计划可用 `getReportEditSession(plan)` 读取已登记会话；独立使用时：

```ts
import { createReportEditSession, createReportCellEditBatch } from '@agile-team/mach-report';
const session = createReportEditSession({ template, datasets, pagination: { maxPages: 100, maxCells: 250_000 } });
const plan = session.plan;
const batch = createReportCellEditBatch(plan, inputs, requestId);
const prepared = await session.prepare(plan, batch, { signal });
// prepared.plan 已验算，但尚未发布；宿主先执行同一原子保存契约。
const result = await saveBatch(batch, { signal, requestId });
const nextPlan = prepared.commit(result);
```

重算失败、取消、重复提交同一个 prepared、或另一笔事务已经提交后再提交旧 prepared，均不改变当前会话。`commit` 推进成功结果的并发令牌。`prepareHistory(plan, edits, 'previousValue' | 'value', requestId, { signal })` 返回 `{ batch, contexts, prepared }`，用于稳定来源的隐藏行恢复；宿主必须先对每个 `contexts` 再执行权限/字段校验和保存，成功后才 commit。`relocateReportCellEdits` 仅定位当前可见格，找不到即明确报错，绝不沿用旧坐标修改其他行。

## Vue 默认计算闭环

`ReportPreview` 对来源会话自动执行“字段与权限校验 → 准备计算及排版 → 原子保存回调 → 发布”。宿主继续使用已有 `editable` / `save` / `saveBatch`，不需要自行调度重算，也不需要在页面维护第二份数据。派生值、合计、条件样式和显隐规则均随同一成功事务更新；失败或取消会保留原计划、原会话与历史，失败重试复用原请求身份。

撤销、重做和恢复按业务来源解析当前目标，包含被 `rowVisibleWhen` 隐藏的行。权限和字段规则在这些操作中仍会执行，不能通过历史恢复绕过。变化导致位置移动时，差异定位、修改标记、选区和编辑后的键盘导航使用新来源坐标；当前已隐藏的项不会误跳或标记到占据旧位置的其他业务行。

打印及全部导出会先提交当前编辑器，并等待正在进行的批量编辑、保存和重算；失败时不输出旧的派生结果。没有待处理编辑时保留即时工具响应。PDF 窗口保留用户手势的同步开窗规则；预览界面在仍有输入或保存时提示先完成修改。

通过 JSON、Worker 或宿主自定义转换传输的计划会保留 `requiresRecalculation` 标记，却无法传输内存中的来源会话。此类需要计算的计划会拒绝编辑，提示由 `messages.editRecalculationUnavailable` 配置；应使用 `reports` / `createReportSource` 保留模板与数据来源，或显式建立核心编辑会话。没有计算依赖的旧静态计划仍沿用原编辑模式。导入 Excel 原公式仍只读，不因此获得通用 Excel 公式计算能力。

已有 Worker/执行器的计划可显式登记原模板与数据，无需初次再排版：

```ts
import { getReportEditSession, registerReportEditSession } from '@agile-team/mach-report';
if (!getReportEditSession(plan)) {
  registerReportEditSession(plan, {
    parts: [{ template, datasets }],
    rebuild: async ([next], signal) => {
      // 复用宿主已有的有界 Worker/执行器；此回调仅在真实编辑后执行。
      const result = await executor.prepare(next.template, next.datasets, signal);
      return result.plan;
    }
  });
}
```

`executor.prepare` 代表宿主已有的执行器适配函数，并非新增通用方法。必须使用回调收到的 `next` 模板/数据及 `signal`，不能闭包回旧来源；返回计划应保留同一业务身份、预算和 `requiresRecalculation` 要求。非 Worker 的 `createReportRuntime.prepare` 已自动登记，不需要重复接线。


## 候选规则、安全预填与数据核对

`editable.validation = { rules, warningPolicy? }` 对完整来源候选执行声明式整行/整批校验；包括隐藏行、派生值、嵌套树子节点，失败不会调用保存。`warning` 默认可保存，显式 `warningPolicy: 'block'` 才阻止。错误列表保留稳定业务键，菜单只在存在问题时出现；无可靠身份的项目不会按显示行号误定位。`validateBatch(batch, candidatePlan, operation)` 可补宿主特有校验，返回结构化问题；它看到的是已重算候选。

规则需要来源会话，原始 RenderPlan 不能声称验证了完整来源数据。核心 `prepared.validationIssues` 为只读结果；Node/其他框架须先 `assertReportValidation`，再调用原子保存，最后 commit，不能先写库再依赖 commit 抛错回滚外部操作。撤销、重做和恢复同样校验，不另开绕过规则的路径。

`ReportPreview` 的 `prefill` 仅需参考 loader 与显式字段白名单；默认只补空白，保留 `0/false`，先审阅再交现有编辑事务。`dataComparison` 是按业务键的只读期间核对，复用当前查询数据与原报表定位。两项配置可由 defaults/preset统一提供，未配置不显示入口；不需要使用侧拼装额外表格、分页或保存历史。

完整类型、示例、身份与预算见[数据工作流](DATA_WORKFLOW.md)，可运行 `/data-tools.html`。业务服务器继续检查权限、字段白名单、并发令牌和整批数据库事务；浏览器校验不能替代这些职责。
