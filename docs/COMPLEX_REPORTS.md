# 复杂报表：计算、分组、主从与动态矩阵

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
  signal,
  onWarning: handleWarning
})) {
  await consumePage(page);
}
```

生成器实际只保留当前排版页和过渡队列，不会先生成完整 `RenderPlan` 再 `yield`。输入数据、业务键索引、分组桶及计算结果仍需按数据预算持有；逐页输出不代表数据源也能无界输入。`{totalPages}` 未提供 `knownTotalPages` 时会做不保留页面的计数遍历；已知总数可省去这一遍。同一次生成器的计数和输出遍历会复用计算/矩阵的准备结果，避免重复克隆计算行。服务端在排版前另做预算预检时，计算维度仍可能额外执行一次 O(N) 数据计算并短暂分配行对象；预检不会因追求速度被跳过。`maxCells` 在每页追加前累计实际网格格数，包含重复表头、页眉页脚与嵌套子组件，超限即终止。旧版 `paginateTemplate` 继续返回完整计划，排版规则由同一个内核实现。

## 验证

新增测试覆盖依赖排序和循环、数值边界、精确大数、空值与零、多个聚合范围、加权总计、多级分组和孤行、主从业务身份、隐藏合并表头、矩阵按查询动态变化、分配前预算、首个 `next()` 的测量边界、双遍计数一致性、取消和真实 PDF/Excel 回读。既有性能预算保持不变。
