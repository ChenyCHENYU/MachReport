# 复杂报表：计算、分组、主从、树形与动态矩阵

MachReport 使用可保存的 JSON 描述报表，浏览器与 Node 共用同一个处理、排版和输出内核。宿主提供数据集、字段契约和模板存储；插件负责依赖校验、计算、关联、分页及预览。设计器的“工具 → 计算与规则”可以直接配置下列能力，无需宿主再造一套表单。

## 计算字段

在列表的 `computed` 中声明计算。字段按依赖拓扑执行，允许先声明使用方，循环依赖在保存和执行前均会拒绝。

```ts
list.computed = [
  {
    field: 'unitCost',
    numeric: 'decimal',
    digits: 4,
    divisionByZero: 'null',
    expression: {
      op: 'divide',
      args: [{ field: 'cost' }, { field: 'quantity' }]
    }
  },
  {
    field: 'plantTotal',
    scope: 'group',
    groupBy: ['plant'],
    numeric: 'decimal',
    digits: 2,
    expression: { aggregate: 'sum', field: 'cost' }
  }
];
```

- `scope: 'row' | 'group' | 'dataset'` 决定聚合读取当前行、当前组或整个数据集；其他字段引用始终读取当前行。
- `sum/count/avg/min/max/weightedAvg` 共用聚合实现。`count` 不指定字段时计行数，指定字段时跳过空值。
- 空值默认向下传播；聚合跳过空值，全部为空时返回 `null`，空计数为 `0`。真实的零保留。
- 除零默认报错，可显式 `divisionByZero: 'null'`。加权平均拒绝负权重，权重总和为零时返回 `null`。
- `numeric: 'decimal'` 使用有界 BigInt 十进制实现，结果为精确文本，采用四舍五入、负值中点远离零；Excel 保留文本以免大数被双精度截断。文本不会先转成 JavaScript `number`。
- 计算支持 `add/subtract/multiply/divide/coalesce` 声明式表达式，可递归组合。最多 2048 个计算字段、每表达式 256 个节点、16 层深度，默认最多 10 万行、200 万个计算单元格。
- 独立数据处理可从 `/analytics` 使用 `computeDataset`、`validateComputedFields`、`getComputationMetadata`。元数据包含字段类型、函数参数数量、聚合和边界规则。
- 字符串公式需要运行时显式提供受信任的 `FormulaAdapter`，并通过 `dependsOn` 声明依赖。引擎不执行 `eval`、宏、SQL 或外部工作簿引用；设计器以声明式公式为默认。

计算输出格始终只读并带 `derived` 标记，不生成业务字段补丁；即使源数据原有同名字段或列显式配置 `editable: true` 也不能解除保护。计算显示替换业务键时，其他源字段继续保留原始业务键定位。模板来源编辑的事务重算见[单元格编辑](./CELL_EDITING.md)。

设计器只在点击“样例验算”时计算前 1000 行，并明确标识这是样例结果，避免输入过程中不断扫描大数据集。该样例不能代替全量业务汇总。

## 多级分组和分页

```ts
list.groups = [
  {
    field: 'plant',
    headerTemplate: '厂区：{value}',
    repeatHeader: true,
    keepWithNext: true,
    aggregates: [{ field: 'cost', op: 'sum', numeric: 'decimal', digits: 2 }]
  },
  {
    field: 'shift',
    headerTemplate: '班组：{value}',
    subtotalLabel: '班组小计',
    aggregates: [{ field: 'unitCost', op: 'weightedAvg', weightField: 'quantity' }]
  }
];
```

分组按外层到内层排列，保留源数据第一次出现的顺序，维度身份区分数字与文本。每级可配置组头、组尾聚合、跨页重复组头和组头防孤行；只要“嵌套组头 + 首行”能放入新页，就会保持同页。组合本身超出整页时使用明确的溢出告警，避免无限换页。旧版单层 `groupBy` 和 `subtotal` 继续支持。

总计可使用 `grandTotal: { aggregates: [...] }`。合计读取原始参与行；平均值和加权平均不会通过“平均各组平均值”得到错误结果。首列也是合计度量时，标签单独占一行，下一行保留所有度量；不会用“小计/合计”覆盖首列数值，连续 Excel 的逻辑行号也随两行同步推进。

## 以业务键关联主从明细

```ts
list.detail = {
  dataset: 'orderLines',
  parentKey: 'orderId',
  foreignKey: 'orderId',
  rowKey: 'lineId',
  revisionField: 'lineRevision',
  sourceTokenField: 'lineToken',
  header: true,
  label: '订单明细',
  unmatched: 'error',
  columns: [
    { field: 'material', header: '物料', widthMm: 80, editable: false },
    { field: 'quantity', header: '数量', widthMm: 40, align: 'right', editable: false }
  ]
};
```

主键和外键必须是非空字符串或有限数字，主表关联键必须唯一。实现先建立索引，以线性时间匹配，避免每个主记录再次扫描全部明细。明细编辑身份使用明细自己的 `dataset + rowKey + field`，不会借用主表显示行号。未匹配明细默认报错，确有业务需要可显式 `unmatched: 'ignore'`，忽略后不再校验未参与明细的主键；实际匹配的明细仍拒绝非法或重复主键。子表 `revisionField/sourceTokenField` 独立声明，省略时不继承主表同名字段。

主从布局属于混合逻辑表；Excel 默认保留安全的逐页布局，不猜测把多张逻辑表拼成单一连续表。显式要求 `sheetMode: 'continuous'` 时会给出不支持混合表的可操作错误。

## 随查询生成动态行列的矩阵

```ts
list.matrix = {
  rowFields: ['plant', 'grade'],
  columnFields: ['month'],
  measures: [
    { field: 'weight', label: '重量', op: 'sum', numeric: 'decimal', digits: 3 },
    { field: 'rate', label: '加权单耗', op: 'weightedAvg', weightField: 'weight' }
  ],
  totals: true,
  rowWidthMm: 44,
  columnWidthMm: 28,
  maxRows: 1000,
  maxColumns: 200,
  maxCells: 2_000_000
};
```

矩阵配置随模板存储；每次查询都按当前数据生成列与聚合行，不需要宿主先手工调用转换函数。完整宽表保留动态列自然宽度，标准纸张模式按配置的列表宽度排版。派生结果统一只读，不生成虚假的业务主键或保存来源。

矩阵拥有自己的 `totals`，不能同时配置普通分组、主从或 `grandTotal`，防止重复聚合平均值。设计器在应用矩阵前说明会替换这些布局，编辑历史可撤销恢复。`computed` 和 `rowVisibleWhen` 可以作为矩阵的源数据前置处理。

维度数量与稠密输出单元格在分配结果前检查。`estimateMatrixTable` 和 `estimateListLayoutCells` 可供服务端预算预检；后者在计算维度存在时使用相同计算流程估算，避免按原始字段错误低估。跨表身份关联与权限仍由宿主提供数据集和保存接口保证。

### 层级交叉表与每级小计

在已有 `matrix` 中增加一个 `hierarchy` 即可启用。未配置时保留原有单列行标签、平面标题、字段名称和度量优先顺序；启用后按维度展开度量列，行维度分列，列维度使用真实 `rowSpan/colSpan` 表头，预览、PDF 和 Excel 共用相同几何。

```ts
list.matrix = {
  rowFields: ['plant', 'grade', 'shift'],
  columnFields: ['year', 'month'],
  measures: [
    { field: 'weight', label: '重量', op: 'sum', numeric: 'decimal', digits: 3 },
    { field: 'rate', label: '加权单耗', op: 'weightedAvg', weightField: 'weight' }
  ],
  hierarchy: {
    row: { labels: ['厂别', '钢种', '班组'], sort: ['asc', 'asc', 'source'], subtotals: [1, 2] },
    column: { labels: ['年度', '月份'], sort: ['asc', 'asc'], subtotals: [1] },
    emptyLabel: '未提供',
    subtotalLabel: '小计',
    totalLabel: '合计'
  },
  totals: true
};
```

- `subtotals` 为从 1 开始的维度前缀深度。例如 `[1, 2]` 输出厂别小计、厂别/钢种小计，末级班组不能再次声明小计；重复或越界配置会直接拒绝。
- `sort` 按每级同父节点排序。默认 `source` 保留首次出现顺序；`asc/desc` 对数字使用数值顺序，对其余值使用确定的类型与文本顺序，不依赖机器语言环境。
- 缺失字段、`undefined` 和 `null` 作为同一空成员；只改变其显示名称，不把空字符串、数字 `0`、文本 `'0'` 或 `false` 合并。度量中的真实零始终保留。
- 小计与总计直接消费原始样本；平均值、加权平均和精确小数不会对已经显示的汇总结果再次聚合。
- 层级模式的 `maxRows/maxColumns` 包含展开的小计与总计。`maxCells` 在密集结果分配前检查；`maxAggregateUpdates` 默认一千万，先检查输入行数 × 行前缀数 × 列前缀数 × 度量数，避免多级小计造成隐藏的计算放大。超预算时应缩小维度或由服务端预聚合。

设计器在“计算与规则 → 矩阵 → 层级维度与小计”提供启用、空维度文案、每级排序、上下调整维度和小计开关。草稿验算和应用沿用原有流程，不要求使用侧转换数据。

列表集成时，层级维度名称默认复用原 `list.columns` 中同字段的 `header`；度量也优先复用输出字段或 `valueField` 的已有标题，并附上“求和 / 平均 / 加权平均”等聚合语义。显式 `hierarchy.row/column.labels` 与 `measure.label` 始终优先，找不到已有标题时保留原字段回退。不会推测或新增业务单位，也不改写原列或矩阵配置；仅增加 `hierarchy: {}` 即可使用已有中文标题。

### 汇总身份与下钻适配

`createMatrixTable()` 的层级结果提供 `metadata.rows/columns`。成员 `key` 使用字段名及带类型的原始维度值，不依赖标签、排序和显示行号；小计保留前缀 `fields/values`，总计使用空前缀。列元数据同时提供度量的输出字段、来源字段与操作，便于宿主构造明确的明细查询条件。

分页计划把列描述放在表头组件 `meta.matrix.columns`，行描述放在各行组件 `meta.matrix.row`；同一逻辑表由 `table.id` 关联。行的 `table.role` 分别为 `body/subtotal/grand-total`。这些是只读分析身份，不会伪造 `source.rowKey`，不能作为业务保存键或权限凭据。下钻查询仍由宿主接口执行权限校验。

### 复杂区域组合

同一数据区域中的矩阵、普通分组、树形、主从保持明确互斥；不能通过删掉校验把它们强行叠加。需要“上方交叉汇总、下方分组明细或主从、固定页脚”时，使用现有 `page.flow.bands`，把各列表作为独立区域：

```ts
page.flow = {
  bands: [
    { componentIds: ['summary-matrix'], topMm: 10, heightMm: 8 },
    { componentIds: ['grouped-details'], topMm: 28, heightMm: 8 },
    { componentIds: ['closing-note'], topMm: 42, heightMm: 5 }
  ]
};
// 对应列表使用稳定 id；静态说明使用 nid。
// 页脚使用 pageAnchor: 'footer'，不加入 flow 分段。
```

引擎保留区域间原始间距，在前一区域结束后继续排版，跨页重复各自表头和已声明的组头，并为页脚留出空间。每个重复区域独占一个分段，不与静态组件并排猜测重排。多表组合的 Excel 使用逐页输出；单张矩阵可使用连续工作表，保留多层合并表头并去除重复表头。

## 树形成本与层级报表

树形属于引擎布局，不要求宿主拍平数据。列表通过 `tree` 声明层级；设计器的“计算与规则 → 树形”提供输入结构、业务键、标签列、父级取值、缩进和预算表单。支持两种明确的数据契约：

```ts
// 扁平输入，根节点的 parentId 为 null 或不提供；输入无需先按父子排序。
list.tree = {
  input: 'flat', idField: 'id', parentField: 'parentId', labelField: 'name',
  indentMm: 3, orphan: 'error', parentValues: 'source'
};
const costs = [
  { id: 'material', parentId: 'total', name: '材料', amount: '0.10' },
  { id: 'total', parentId: null, name: '成本合计', amount: '0.30' },
  { id: 'energy', parentId: 'total', name: '能源', amount: '0.20' }
];

// 嵌套输入，每个节点依然必须提供稳定 id。
list.tree = {
  input: 'nested', idField: 'id', childrenField: 'children', labelField: 'name',
  parentValues: 'leaf-aggregate',
  aggregates: [{ field: 'amount', op: 'sum', numeric: 'decimal', digits: 2 }]
};
const nestedCosts = [{ id: 'total', name: '成本合计', children: [
  { id: 'material', name: '材料', amount: '0.10' },
  { id: 'energy', name: '能源', amount: '0.20' }
] }];
```

`parentValues: 'source'` 为默认策略，保留接口给出的父级金额，绝不擅自用子级覆盖。`leaf-aggregate` 必须显式提供 `aggregates`，只将**后代叶子节点**放入每个父节点的聚合器，不累加中间父级来源值。平均值和加权平均直接读取叶子与权重，不先平均各父级结果。支持与普通聚合相同的 `sum/count/avg/min/max/weightedAvg`、`valueField/weightField`、精确小数和空值语义。聚合输出不能覆盖节点键、父键、子数组或标签字段；未声明的父级字段保持来源值。

树形列表的 `grandTotal` 同样仅统计叶子，避免父子重复求和。父级与叶子金额在业务上不属于可加总关系时，保留父级来源值并显式声明合计表达式；插件不会猜测业务口径。全空聚合为 `null`，真实零仍为 `0`，精确小数结果仍为字符串。计算顺序为“当前行 `computed` → 父级叶子聚合 → 单元格条件样式 → 测量与分页”。树形仅支持当前行计算，不支持包含父子行的 dataset/group 范围计算。

### 身份、编辑与输出

- 节点键区分数字和字符串；必须非空且全树唯一。根节点和同级节点保留来源首次出现顺序，分页保持深度优先顺序。
- Flat 孤儿节点默认报错，明确配置 `orphan: 'root'` 才提升为根；不提供静默丢弃策略。自引用、父子循环、重复键、非法子数组在排版前拒绝。
- 默认以 `idField` 作为编辑业务键；显式 `rowKey` 必须一致。扁平输入的普通来源字段可沿用现有 `reports` 编辑事务，叶子修改后先重算父级、条件样式与页，再保存并提交结果。节点键和父键只读；派生父级聚合格只读且没有虚假的来源补丁。嵌套输入首版全部只读，避免使用根数组下标错误更新子节点。
- 首版展示、打印与导出**全量树**，没有折叠造成的隐藏导出口径。标签列使用左对齐；数值列沿用字段语义对齐。DOM、Canvas 与 PDF 使用真实毫米缩进，Excel 使用原生 `indent` 单位近似（约 2.5 mm/级单位），文本与原始值不插入空格。深层缩进最多占用标签列宽度减去内距与 4 mm，保留可阅读的标签空间。
- 树可以与行级计算、单元格条件样式、合并表头、总计及重复表头组合。首版与普通分组、主从、矩阵、行可见条件和单记录区域互斥，结构校验与直接核心执行均拒绝歧义组合。切换设计器布局时先说明替换范围，应用进入现有撤销历史。

### 性能与服务端契约

节点索引为 O(n)，遍历使用显式有界栈，不递归调用 JavaScript 栈；来源模式只保留行引用，不为每个节点深拷贝数据。默认最多 100,000 节点、64 层；可显式配置 `maxRows`（上限 1,000,000）、`maxDepth`（上限 256）。叶子向祖先聚合的访问量由 `maxAggregationVisits` 独立限制，默认 1,000,000，最高 10,000,000；每个聚合字段的一次累加计为一次访问，避免深树与多度量放大 CPU 工作。单树最多 32 项聚合。已有页数、单元格、输出和执行取消预算继续生效。

`createTreeTable(rows, options)` 与类型从核心入口导出，可供 Node 独立处理与校验；模板、数据与这些声明可序列化传递给 Worker。设计器样例验算要求完整关系样例，最多 1,000 个节点，不截取前 1,000 行后伪报孤儿错误。变更验收的 20/100 对树形报表表示本次总节点预算，保持完整关系，超出时提示更换范围，不生成假的孤儿节点错误。

设计画布只对最多 200 个完整树节点、2,000 次聚合访问进行有界样例处理，再显示前三行（流式区域或单记录布局只显示一行）。样例与实际输出共用单元格格式、缩进和只读元数据。数据不完整、需要公式适配器或超出画布预算时显示提示，不将未经汇总的父级来源金额伪装成计算结果；完整排版请打开报表预览。

同一 `DatasetContract` 对嵌套树所有节点的标量字段生效，`children` 容器不作为文本字段声明。来源校验、验收样例与服务端共享行预算均计入后代节点，不能只统计根行。静态模板的 `runtime.describe().datasetsSchema` 包含递归 `children` JSON Schema；动态模板加载器无法在 `describe` 阶段预知结构，实际查询仍按已加载树模板完整校验。

## 条件规则与列显隐

`column.rules` 在排版前合成最终样式；`column.visibleWhen` 隐藏单元格内容并保持几何位置、关闭该格编辑；`list.rowVisibleWhen` 在计算后筛选参与显示和汇总的行。预览、PDF、Excel 消费同一份最终计划。

```ts
column.visibleWhen = { field: 'quantity', op: '>', value: 0 };
column.rules = [{
  when: { field: 'cost', op: '>', value: '9007199254740993.01', numeric: 'decimal' },
  style: { color: '#b91c1c', backgroundColor: '#fff1f2' }
}];
```

`hidden: true` 隐藏物理列，同时投影多层表头的合并范围；至少保留一列。精确小数阈值使用 `numeric: 'decimal'`，避免按文本字典序或浮点数比较大数。

## 页眉页脚与真正的逐页排版

静态文本、图片或网格可声明 `pageAnchor: 'header' | 'footer'`。每页重复，并预留页眉下边缘、页脚上边缘之间的内容区；页脚网格中的 `{page}`、`{totalPages}` 也会替换。A3/A4 使用相同几何规则。完整宽表的锚点按预览分段高度工作；需要页脚贴底时，该分段保持页脚所需高度。

```ts
import { paginateTemplatePages, countTemplatePages } from '@agile-team/mach-report';

const total = countTemplatePages(template, datasets, { maxPages: 5000 });
for (const page of paginateTemplatePages(template, datasets, {
  knownTotalPages: total,
  maxPages: 5000,
  maxCells: 2_000_000,
  maxChartComponents: 50_000,
  signal,
  onWarning: handleWarning
})) {
  await consumePage(page);
}
```

生成器实际只保留当前排版页和过渡队列，不会先生成完整 `RenderPlan` 再 `yield`。输入数据、业务键索引、分组桶及计算结果仍需按数据预算持有；逐页输出不代表数据源也能无界输入。`{totalPages}` 未提供 `knownTotalPages` 时会做不保留页面的计数遍历；已知总数可省去这一遍。同一次生成器的计数和输出遍历会复用计算/矩阵的准备结果，避免重复克隆计算行。服务端在排版前另做预算预检时，计算维度仍可能额外执行一次 O(N) 数据计算并短暂分配行对象；预检不会因追求速度被跳过。`maxCells` 在每页追加前累计实际网格格数，包含重复表头、页眉页脚与嵌套子组件，超限即终止。旧版 `paginateTemplate` 继续返回完整计划，排版规则由同一个内核实现。

绑定图表另有 `maxChartComponents` 图元预算，默认 50,000，可设为 1..1,000,000 的整数；不占用或改变 `maxCells` 网格预算。同一次排版遍历的普通页与流式续页共享额度；计数遍历与输出遍历分别计量。每张图在生成基础图元数组前，按聚合后的分类、非空数据点、线段与采样坐标轴计算保守上界，超限抛出 `PaginateChartComponentLimitError`；堆叠数值标签可能因空间不足省略，因此上界可略高于最终数量。空数据占位也计入一个图元。缩小分类/系列、分批生成或显式调整预算，避免先展开大量图元再由输出端拒绝。

`createReportSource(reports, { maxChartComponents })` 为一次请求中的全部报表共享同一额度，编辑后的完整重算也保留该限制；报表自身 `pagination.maxChartComponents` 可进一步下调。`paginateTemplate` 返回的 `chartComponents` 是实际生成量，不包含计数预遍历，也不把普通静态组件算成图表。该预算保护绑定图表的展开过程，已生成计划的输出仍使用原有渲染树与文件预算。

## 验证

新增测试覆盖依赖排序和循环、数值边界、精确大数、空值与零、多个聚合范围、加权总计、多级分组和孤行、主从业务身份、隐藏合并表头、矩阵按查询动态变化、分配前预算、首个 `next()` 的测量边界、双遍计数一致性、取消和真实 PDF/Excel 回读。既有性能预算保持不变。
