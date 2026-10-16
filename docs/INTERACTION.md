# 预览交互：能力按需，接入保持精简

常规页面继续只传 `report-id` 和 `params`。设置入口默认可见，编辑与 Excel 导入仍由宿主显式授权；工具偏好不能绕过宿主关闭的能力。包内处理焦点、选区、编辑历史、导入摘要和屏幕冻结，使用侧不需要监听每个单元格。

## 完整宽表与冻结窗格

```vue
<MachReportPreview
  report-id="production"
  :params="query"
  :interaction="{ freezeHeaders: true, frozenColumns: 2 }"
  editable
  excel-import
/>
```

`freezeHeaders` 和 `frozenColumns` 默认关闭，可通过设置切换；前列数量为 0～20。屏幕滚动时只对当前挂载的预览节点应用位移，保持完整列宽；不会改变 `RenderPlan`、PDF、Excel 或打印几何。列表识别其表头片段，静态网格冻结第一行。不同布局应根据业务选择，静态网格的第一行不会被自动推断为复杂多行表头。

导入多个 Sheet 后出现工作表导航；多表计划有 `table.title` 时显示章节。`interaction.navigation: false` 可隐藏导航与字段定位。工具栏原有分页、缩放、搜索和缩略图继续使用。

## 选区、键盘与定位

单击选择，Shift + 单击或方向键扩展选区；方向键、Tab 可在同一逻辑表的分页片段之间导航。合并格按左上角定位，不生成虚假的可写占位格。Ctrl/Cmd + C 复制矩形内容；粘贴、撤销及业务原子保存约束见[单元格编辑](./CELL_EDITING.md)。

```ts
const report = useMachReport();
await report.focusField({ datasetId: "detail", rowKey: "HEAT-001", field: "quantity" });
await report.focusCell({ pageIndex: 0, componentIndex: 1, rowIndex: 0, columnIndex: 1 });
const selection = report.getSelection();
const text = report.copySelection();
const success = await report.pasteSelection("12\t00123\r\n0\t00124");
```

坐标 API 从 0 开始，页码导航从 1 开始。字段定位也可在预览的输入框内直接输入 `field`；需要指定业务行时调用 `focusField`。只操作已加载计划，未找到目标返回 `false`。`getSelection()` 返回独立快照，不修改预览状态。

## 可选偏好存储

默认工具偏好只留在实例中。需要用户级记忆时注册一个存储适配器，页面仍然只传报表 ID：

```ts
import { createReportStoragePreferences, defineMachReportConfig } from "@agile-team/mach-report/vue";

const config = defineMachReportConfig({ defaults: {
  preferences: {
    key: `reports:${tenantId}:${userId}:tools`,
    adapter: createReportStoragePreferences(localStorage)
  },
  interaction: { frozenColumns: 1 }
} });
// 将 config 交给现有 app.use(machReportPlugin, { reports, config })。
```

`adapter` 提供 `load(key)`、`save(key, value)`，可同步或异步；`remove` 为可选扩展。加载结果只接收已知工具的布尔值；晚到的加载不会覆盖用户的新操作，保存按顺序执行。读写失败会发出 `warning`，当前实例仍可使用设置。键应包含用户/租户范围，退出登录后由应用清理；SSR 中在客户端取得浏览器存储后再注册。

当前适配器存储阅读/输出/编辑/导入工具的开关；冻结数量是当前实例的交互配置，列宽、业务对齐和模板样式属于模板或宿主的展示配置，不会隐式写入工具偏好。

## 导入兼容摘要与状态

Excel 导入完成后，预览保留 Sheet 导航，并展示可展开的兼容摘要：工作表名称、范围、行列数量和转换告警。只保留摘要数据，不在预览状态中额外复制整个模板。公式、日期和受保护格保持只读，公式不重算；完整边界见[Excel 模板导入](./EXCEL_IMPORT.md)。

编辑时可看到保存状态、净差异数量和冲突明细。错误保留当前计划；重新查询会取消在途操作并回到接口快照。设置中的隐藏工具不会自动丢弃正在输入的值：关闭编辑前会先校验并提交，失败时保留输入和编辑开关。
