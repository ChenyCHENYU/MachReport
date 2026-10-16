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

只读预览同样支持选区与复制。首格的 Shift + Tab、末格的 Tab 按浏览器焦点顺序离开网格，不把键盘困在报表中；表头保持 `columnheader` 语义。缩略图使用带页码名称的按钮，支持 Tab 聚焦、Enter/空格激活，并向辅助技术声明当前页。

多层表头与业务行使用独立的选区坐标，跨页复制、粘贴不会把第一行业务数据误认作第二层表头；在业务行间按方向键或 Tab 跨页时，会跳过打印用途的重复表头。

在报表内按 Ctrl/Cmd + F 可打开或重新聚焦内容搜索；搜索框内 Enter/Shift + Enter 切换下一处/上一处匹配，Esc 关闭并返回搜索按钮，也可点击关闭按钮。输入法组合期间的 Enter 不触发导航。搜索输入框继承预览主题，宿主可通过 `messages.closeSearch`、`prevSearchMatch`、`nextSearchMatch` 覆写辅助标签。

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

存在活动编辑器时，打开设置也会先等待当前修改完成；校验或保存失败会保留编辑器焦点，不会打开弹窗将错误输入遮在后方。

## 中文列目录与复杂宽表

定位输入框同时搜索中文列名、字段标识和多层合并标题，结果按章节/逻辑表/数据集分组。同名字段通过稳定tableId消歧，空数据报表可定位到对应表头；重复打印表头不会重复列出。目录从计划生成，使用侧不维护另一套字段配置。高级定位可调用 `focusField({ field, datasetId, tableId })`。

默认修改保护、可取消阶段状态与可定位输出诊断见[产品操作流程](./PRODUCT_WORKFLOWS.md)。普通页面无需为这些状态额外绑定事件；`state`、控制器与默认界面共用相同生命周期。
