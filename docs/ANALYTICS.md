# 分析与资源适配

分析能力位于独立 `/analytics` 入口；它只生成数据或基础图元，可供浏览器与 Node 共用，不引入图表框架和公式引擎。

## 交叉汇总

```ts
import { createCrossTable } from "@agile-team/mach-report/analytics";
import { createTableTemplate, paginateTemplate } from "@agile-team/mach-report";

const result = createCrossTable(rows, {
  rowField: "shift", columnField: "grade", valueField: "weight",
  aggregate: "sum", totals: true
});
const template = createTableTemplate({ layout: "wide", columns: result.columns });
const { plan } = paginateTemplate(template, { detail: result.rows });
```

支持 `sum / count / avg / min / max`。维度按首次出现的顺序排列，数字和同形文本保持不同身份；真实 `0` 保留，缺失组合在count中为0，其他聚合为 `null`。总平均按原始样本计算。数值文本不会隐式转换，以免编号或高精度小数失真。

默认输入最多 100,000 行、1,000 个行维度、200 个列维度和 2,000,000 个输出单元格，可用 `maxInputRows / maxRows / maxColumns / maxCells` 调整；超限明确报错。此 API 是受控交叉汇总，不是完整的 Excel 透视表编辑器。

## 声明式计算

```ts
import { computeDataset } from "@agile-team/mach-report/analytics";

const { rows: computed, issues } = computeDataset(rows, {
  fields: [{ field: "amount", expression: {
    op: "multiply", args: [{ field: "qty" }, { field: "price" }]
  } }]
});
```

字段按声明顺序计算，后续字段可引用前面的计算结果。支持 `add / subtract / multiply / divide / coalesce`、字段引用与有限 JSON 标量；不修改输入。表达式限制深度 16、节点 256、计算字段 2,048 个；行数默认最多 100,000、计算结果最多 2,000,000 格（`maxRows / maxCells` 可调）。除零、非数值运算与非有限结果默认失败并定位行与字段；显式 `onError: "null"` 才将失败结果置空并返回问题。

字符串表达式必须提供 `formula.evaluate(expression, { row, rowIndex })`。适配器是宿主选择的受信任引擎，需返回同步有限标量；本包不执行 `eval`、宏或外部工作簿引用，也不重算导入 Excel 的公式缓存。

## 基础图表

```ts
import { createChartComponents } from "@agile-team/mach-report/analytics";

const components = createChartComponents({
  type: "line", title: "产量趋势", categories: ["甲班", "乙班"],
  series: [{ name: "产量", values: [0, 120] }],
  leftMm: 10, topMm: 20, widthMm: 160, heightMm: 80
});
// 放入页面 components；DOM、Canvas、PDF 共享线、矩形、文字图元。
```

支持柱图、折线图、图例、负值、空值断点、标签与显式颜色。最多 200 类、12 系列；超限或非法数字拒绝。坐标和斜线使用统一计划几何；Excel 工作表出口仍按自身能力返回非表格告警，不宣称生成原生 Excel 图表对象。

## 二维码、条码、其他图表

```ts
import { resolvePlanAssets, inspectOutputCapabilities } from "@agile-team/mach-report";

const { plan: prepared, diagnostics } = await resolvePlanAssets(plan, {
  signal,
  assetRenderers: {
    qrcode: async ({ component, signal }) => qrAdapter.toDataUri(component, signal)
  }
});
const outputIssues = inspectOutputCapabilities(prepared, "pdf");
```

二维码算法、条码算法或复杂图表可通过自己的依赖适配器返回图片 Data URI。相同组件资源去重，已有 `imageData` 保留，递归处理嵌套格。默认最多新生成 1,000 个资源、单个 32 MiB、合计 128 MiB、30 秒；通过 `assetBudget` 配置。失败默认拒绝，显式 `assetFailure: "placeholder"` 才使用占位并返回告警。

Vue 的 `assets` 属性 / defaults 配置自动在取数或导入后准备资源，同一计划再用于预览和导出。没有配置资源渲染器时保持原有行为。Canvas / PNG 请用异步渲染 API，等待图片解码；同步 Canvas 会诊断需要异步渲染的图片。PDF 字体与资源支持边界见[PDF 指南](./PDF.md)和[输出质量矩阵](./QUALITY.md)。
