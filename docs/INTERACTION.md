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

导入多个 Sheet 后出现工作表导航；多表计划有 `table.title` 时显示章节。`interaction.navigation: false` 可隐藏导航与字段定位。分页与跳页位于预览右下方，格式出口集中在导出菜单；缩放、内容搜索和缩略图保持独立分组。普通接入无需手动组装控件；需要自定义容器时可从 `/vue` 单独导入 `ReportPagination`，通过 `pageCount`、`currentPage`、`messages` 和 `@goto` 接入现有状态。

分页控件在包内维护表单、标签、按钮与输入框的间距和排版基线，避免宿主通用 `form` / `label` 样式使跳页组偏移。页码、前后箭头与跳页输入保持同一垂直中心线；是否启用左侧选区计算均使用相同的右侧内边距，使用侧无需补写控件对齐样式。

## 设置、主题与精简布局

预览外壳默认浅色，空态插图默认淡蓝。应用配置 `theme.emptyAccent` 可单独覆盖插图强调色；`theme` 只作用于预览外壳，不改写报表模板、PDF、Excel 或打印样式。

设置按三页组织：

| 页签 | 内容 |
| --- | --- |
| 常规 | 冻结表头、前列数量及宿主放入 `#settings` 的版式等选项 |
| 工具 | 搜索、缩略图、缩放、导出、打印及宿主已授权的编辑 / 导入能力 |
| 高级 | 默认关闭的选区计算及计算方式、精度与结果 |

页签支持 ← / →、Home / End 切换；Tab 保持在面板内，Esc 关闭并返回打开面板前的焦点。设置不能把宿主未授权的编辑、导入或输出变为可用。工具偏好和冻结 / 计算等实例交互状态分别维护，后者不会隐式写入 `preferences` 适配器。恢复默认会还原本实例的工具与交互设置。

```ts
defineMachReportConfig({ defaults: {
  theme: { emptyAccent: "#79a7e8" },
  interaction: { calculations: true }
} });
```

`calculations` 省略或为 `false` 时不默认开启；用户也可在高级页按需启用。业务版式仍由模板及宿主控制，可放入常规页，避免在预览上方常驻另一排配置。显示 SVG 空态须由宿主按成功查询的真实行数传 `emptyState`，组件不会把空白数值猜成零条业务数据。

## 选区、键盘与定位

单击选择，Shift + 单击或 Shift + 方向键扩展选区；方向键、Tab 可在同一逻辑表的分页片段之间导航。合并格按左上角定位，不生成虚假的可写占位格。Ctrl/Cmd + C 复制矩形内容；粘贴、撤销及业务原子保存约束见[单元格编辑](./CELL_EDITING.md)。

只读预览同样支持选区与复制。首格的 Shift + Tab、末格的 Tab 按浏览器焦点顺序离开网格，不把键盘困在报表中；表头保持 `columnheader` 语义。缩略图使用带页码名称的按钮，支持 Tab 聚焦、Enter/空格激活，并向辅助技术声明当前页。

多层表头与业务行使用独立的选区坐标，跨页复制、粘贴不会把第一行业务数据误认作第二层表头；在业务行间按方向键或 Tab 跨页时，会跳过打印用途的重复表头。

在报表内按 Ctrl/Cmd + F 可打开或重新聚焦内容搜索；输入时显示检索状态和命中计数，无匹配时有独立反馈，清除按钮保留输入焦点。搜索框内 Enter / Shift + Enter 切换下一处 / 上一处匹配，Esc 关闭并返回搜索按钮，也可点击关闭按钮。输入法组合期间的 Enter 不触发导航。搜索输入框继承预览主题，宿主可通过 `messages.closeSearch`、`prevSearchMatch`、`nextSearchMatch` 覆写辅助标签。

```ts
const report = useMachReport();
await report.focusField({ datasetId: "detail", rowKey: "HEAT-001", field: "quantity" });
await report.focusCell({ pageIndex: 0, componentIndex: 1, rowIndex: 0, columnIndex: 1 });
const selection = report.getSelection();
const text = report.copySelection();
const success = await report.pasteSelection("12\t00123\r\n0\t00124");
```

坐标 API 从 0 开始，页码导航从 1 开始。字段定位也可在预览的输入框内直接输入 `field`；需要指定业务行时调用 `focusField`。只操作已加载计划，未找到目标返回 `false`。`getSelection()` 返回独立快照，不修改预览状态。

## 可选的只读选区计算

普通接入只需一个开关，不必开启 `editable`，也不用额外注册组件或计算回调：

```vue
<MachReportPreview report-id="production" :params="query" :interaction="{ calculations: true }" />
```

也可由用户在「设置 → 高级」开启。先关闭设置，单击起点，用 Shift + 单击或 Shift + 方向键扩选；再从底部的「选区计算」入口打开高级页，选择计算方式并点击「计算选区」。仅显式运行时才计算，选区移动不会触发重复扫描。

| 方式 | 含义 |
| --- | --- |
| SUM | 对参与的原始数值求和 |
| AVERAGE / AVG | 数值平均值 |
| MIN / MAX | 数值最小 / 最大值 |
| COUNT | 有限数值格数量，包含真实 `0` |
| MEDIAN | 排序后的中位数；偶数个样本取中间两项均值 |
| 组合公式 | 对摘要变量做四则运算，如 `SUM / COUNT`、`(SUM - MIN) / COUNT` |

组合公式允许 `SUM`、`AVERAGE` / `AVG`、`MIN`、`MAX`、`COUNT`、`MEDIAN`、有限数值常量、`+ - * /` 及括号；名称不区分大小写。这里使用摘要变量，而非 Excel 的函数调用或单元格范围语法。长度最多 256 字符、64 个 token、16 层深度；脚本、属性访问、任意函数、外部引用及 Excel 原公式均不会执行。

参与规则与结果边界：

- 仅原始有限 `number` 纳入；显式文本格、文本编号、数字字符串、日期、布尔、空值及仅有展示文本的格排除，不隐式转换。真实 `0` 保留；缓存为数字的公式结果可参与静态分析，公式本身不求值。
- 合并格按锚点计一次；同一逻辑表的跨页片段按逻辑行与字段身份去重，打印表头、分组头及结构汇总不叠加。不同逻辑区域不作为一个选区混算。
- 没有可计算数值时，COUNT 返回 `0`，其余方式显示空结果；界面同时显示参与数值与排除格数。
- 计算采用 IEEE-754 浮点数；0～12 位展示精度只控制格式，不改源值。应选择单位与量纲一致的数据；不安全整数输入或结果、除零、溢出、非法表达式及超限均有诊断，不展示伪造的部分合计。
- 结果仅供当前本地分析，不触发字段编辑校验、保存回调或业务请求，不写数据库、不修改 KPI、模板与原公式。

预览默认限制选区面积为 100,000 格，扫描工作预算为 200,000（含片段遍历与合并跨度开销）。扫描和中位数排序分批让出事件循环；在途计算可以取消。选区、报表计划或公式配置变化，以及关闭能力、卸载预览，都会取消旧任务并清理旧结果。大范围查询仍应由业务服务端限制数据范围。

核心入口同时提供与框架无关的 `calculateReportSelection(plan, selection, options)` 和 `evaluateReportAggregateExpression(expression, summaries)`；`maxCells`、`maxScannedCells`、`signal` 属于显式高级调用选项，普通 Vue 接入无需设置预算或自行维护计算状态。

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

点击「字段目录」打开搜索弹层，同时搜索中文列名、字段标识和多层合并标题，结果按章节 / 逻辑表 / 数据集分组。↑ / ↓ 选择候选项，Enter 定位，Esc 关闭并返回入口；无匹配时显示提示。一次最多挂载 100 个候选，超过上限时提示总匹配数，继续输入可缩小范围。

同名字段通过稳定 `tableId` 消歧，空数据报表可定位到对应表头；重复打印表头不会重复列出。目录从计划生成，使用侧不维护另一套字段配置。高级定位可调用 `focusField({ field, datasetId, tableId })`。

默认修改保护、可取消阶段状态与可定位输出诊断见[产品操作流程](./PRODUCT_WORKFLOWS.md)。普通页面无需为这些状态额外绑定事件；`state`、控制器与默认界面共用相同生命周期。
