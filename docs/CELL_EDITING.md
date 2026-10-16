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
| 公式单元格 | 始终只读，使用已有缓存结果，不进行重算 |
| Excel 导入的日期格 | 保留序列和显示格式，目前保持只读 |
| 带嵌套内容的复杂单元格 | 保持只读，避免文本输入破坏内部结构 |
| 单元格 `editable: false` | 始终只读，即使整个预览开启编辑 |

模板静态网格和列表列可通过 `editable` / `valueType` 声明策略。例如数量列可以用 `editable: true, valueType: "number"`，不可修改的编号列设为 `editable: false`。只读约束不能被 `canEdit` 绕过，后者仅能进一步收紧权限。

这是报表内容编辑能力。编辑数值不会重新执行后端汇总逻辑，也不会自动重算 Excel 公式、列表小计或跨表依赖。需要这些规则时，由业务保存接口计算并重新查询报表。单元格继续使用模板中的尺寸和样式，超长内容应通过模板行高、换行或后续查询排版处理。

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

只读 `state` 提供 `editing`、`saving`、`importing`、`dirty`、`canUndo`、`canRedo`、`changeCount` 和 `selection`。`dirty` 表示相对本次来源仍有净差异，不代表后台是否已持久化；有保存回调时同样会记录差异。离开提示和重新查询时机由应用决定。冻结、工具偏好与字段定位见[预览交互](./INTERACTION.md)。

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
