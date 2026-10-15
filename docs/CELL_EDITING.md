# 单元格编辑

报表默认只读。Vue 预览传入 `editable` 后，双击可编辑的单元格即可输入；输入类型、计划更新、输出同步、保存失败和过期任务隔离由包内处理。

## 只需一个开关

```vue
<MachReportPreview report-id="production" :params="{ date }" editable />
```

| 操作 | 行为 |
| --- | --- |
| 双击单元格 | 打开当前值的编辑框 |
| Enter | 校验并提交 |
| Shift + Enter | 文本内换行 |
| Esc | 取消当前输入 |
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
  save: (edit, { signal }) => reportApi.saveCell(edit, { signal })
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

`canEdit` 决定是否打开编辑框；`validate` 可同步或异步返回错误文字，也可抛出异常。`save` 在计划变更前执行，只有完成后才应用修改并发出 `cell-edit`。保存期间不会重复提交；失败保留原计划并显示错误，用户可修正或取消。重新查询、导入其他模板或卸载会取消旧操作，即使不消费 `signal` 的保存函数晚些返回，也不会覆盖新报表。

`reportApi.saveCell` 是宿主自己的请求函数，需绑定明确的业务记录和字段。`address` 是本次计划中的物理位置，`table` 提供逻辑表、行和列身份，均不能代替后端主键、权限和版本校验。服务端仍需验证租户、可写字段、封月状态和并发版本。请求函数消费 `signal` 可终止真实请求；浏览器取消本身不能撤销服务端已完成的写入。

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
const snapshot = report.getPlan();
```

`getChanges()` 返回本次成功编辑的独立补丁快照；`getPlan()` 返回当前计划的独立快照，修改返回值不会影响预览。`cell-edit` 的参数包括 `address`、可选 `table`、`previousValue`、`previousText`、`value` 和 `text`。结构化错误通过现有 `error` 事件报告。

只读 `state` 增加 `editing`、`saving`、`importing`、`dirty`。`dirty` 表示本次预览已有成功修改，不代表后台是否已持久化；有 `save` 时同样会记录修改。批量保存策略可通过 `getChanges()` 接入，保存按钮、离开提示和重新查询时机由应用决定。

## 不使用 Vue

核心入口提供同一套不可变编辑操作，不加载 Vue 或 ExcelJS：

```ts
import {
  createReportCellEdit,
  applyReportCellEdit
} from "@agile-team/mach-report";

const edit = createReportCellEdit(plan, {
  pageIndex: 0,
  componentIndex: 1,
  rowIndex: 0,
  columnIndex: 1
}, "0");
const updatedPlan = applyReportCellEdit(plan, edit);
```

合并单元格使用左上角的物理网格坐标。创建补丁会检查类型与只读规则，应用补丁会检查原值冲突；带逻辑表身份的镜像单元格同步更新。其他框架可自行提供输入界面，把同一更新计划交给渲染和导出 API。
