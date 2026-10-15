# Excel 导出指南

MachReport 支持生成真正的 `.xlsx` 工作簿。入口是 `@agile-team/mach-report/xlsx`，Vue 预览工具栏也提供「导出 Excel」。宽表默认连续 Sheet 与 raw 原始值，普通页面保留逐页 Sheet 与 text 显示文本，均可显式配置。

## 能力矩阵

| 能力 | 当前支持 | 边界 |
| --- | --- | --- |
| 工作簿 | auto 模式按逻辑表合并 wide 分段，其余每页一张 Sheet | pages 强制逐页；continuous 要求明确列表元数据 |
| 完整宽表 | 所有列按自然宽度保留，同一逻辑表纵向连续 | 不根据纸张宽度压缩或截掉列；多报表隔离 |
| 表格 | 表头、明细、分组、小计、总计 | 汇总已在分页时计算，不生成 Excel 公式 |
| 尺寸与合并 | 列宽、行高、`colSpan` / `rowSpan` | 越界跨度裁剪在当前网格内；同 Sheet 的网格共用列宽 |
| 标题 | 合并到当前页表格的实际列数 | 纯文本页使用单列，绝对坐标转为组件顺序 |
| 字体与样式 | 共享字号规则、字体族、加粗/斜体/下划线、颜色、水平/垂直对齐、换行、底色、边框开关/颜色 | 边框线型为细线，不映射旋转、透明度等 |
| 单元格值 | text 模式写显示文本；raw 模式写原始 primitive 和数字格式 | Date/对象回退显示文本，不猜数字字符串 |
| 图片与复杂内容 | 返回跳过告警 | 图片、条码、二维码、图表、嵌套组件、无文本回退的富文本等未导出 |
| 打印配置 | 普通页 auto 识别 A3/A4/A5；wide 默认不强制纸型，可显式 paperSize | 纸型仅影响打印；不是 PDF 坐标复刻 |
| 运行环境 | 浏览器、Node.js | 整本工作簿在内存中生成，暂无流式输出或取消接口 |

`/xlsx` 同时提供 `importExcelTemplate()`，可将 `.xlsx` 的多工作表、合并、尺寸、基础样式与已有内容转换为可复用模板，详见[Excel 模板导入](./EXCEL_IMPORT.md)。预览可按需开启[单元格编辑](./CELL_EDITING.md)；完整工作簿编辑器、透视表交互和公式计算不在当前 API 范围。主入口不加载 ExcelJS；实现与类型随 `/xlsx` 子入口发布。公开 `workbook` 保留 ExcelJS API，Node 类型依赖用于其 stream 签名。

## Node.js 最小示例

```ts
import { writeFile } from "node:fs/promises";
import { createTemplate, paginateTemplate } from "@agile-team/mach-report";
import { renderPlanToXlsx } from "@agile-team/mach-report/xlsx";

const template = createTemplate()
  .page("a4")
  .text("出库明细", { leftMm: 12, topMm: 10, widthMm: 186, heightMm: 10 })
  .list("detail", { leftMm: 12, topMm: 25, widthMm: 186 }, [
    { header: "物料", field: "name", widthMm: 120 },
    { header: "数量", field: "qty", widthMm: 66 }
  ])
  .build();

const { plan, warnings: paginationWarnings } = paginateTemplate(template, {
  detail: [{ name: "物料 A", qty: 3 }]
});
const { buffer, warnings: exportWarnings } = await renderPlanToXlsx(plan, {
  valueMode: "raw",
  sheetName: (pageIndex) => `出库明细${pageIndex + 1}`
});

console.warn([...paginationWarnings, ...exportWarnings]);
await writeFile("report.xlsx", new Uint8Array(buffer));
```

`sheetName` 使用从 `0` 开始的输出工作表索引，逐页模式与页索引相同。名称需要唯一并满足 Excel 工作表命名规则；连续表默认使用清理后的标题，重名自动追加序号，其余默认 `Sheet1`、`Sheet2` 等。

## 完整宽表：默认连续导出

```ts
import { createTableTemplate, paginateTemplate } from "@agile-team/mach-report";

const template = createTableTemplate({
  layout: "wide",
  title: "炼钢生产日报",
  columns: productionColumns // 全部业务列，自动列默认每列 30 mm
});
const { plan } = paginateTemplate(template, { detail: productionRows });
const { buffer, warnings } = await renderPlanToXlsx(plan);
```

不需要另写数据 Sheet、拼接页或删除重复表头。包内按稳定表 ID、逻辑行序、角色与列身份重组；标题和表头只写一次，明细、组头、小计、总计保持顺序。连续表自动冻结标题和表头，打印时重复这些行。不同报表即使字段相同也保持独立工作表。

`sheetMode` 有三个值：

| 值 | 行为 |
| --- | --- |
| `auto`（默认） | wide 列表连续导出，其他页面保持逐页行为 |
| `pages` | 全部按预览分段 / 页面输出，适合保留旧工作簿结构 |
| `continuous` | 对带完整列表元数据的计划按逻辑表连续导出；任意未标记网格或不明混合布局明确报错 |

宽表预览默认 100% 并支持横向滚动，内部纵向分段用于窗口化；这些分段不再决定 Excel 的 Sheet 边界。工厂默认 page 保持兼容，需要宽表时显式加一个 `layout` 字段即可。

## A3 / A4 是打印选配

```ts
const result = await renderPlanToXlsx(plan, { paperSize: "a3" });
// 也可以 paperSize: "a4"；不改变工作表列宽、单元格值和连续结构。
```

wide 默认不强制纸型；显式 A3/A4 设置工作簿的打印纸型和适页方式。它只影响打印视图，列很多时打印缩放可能很小，应按业务选择纸张与打印范围。若预览和 PDF 本身就要固定纸张，创建另一个 `createTableTemplate({ paper: "a3", landscape: true, columns })` 标准模板；不要在 wide 模板同时设置 `paper / landscape`。

## 浏览器和 Vue

Vue 工具栏会动态加载 `/xlsx`，创建下载并通过 `warning` / `error` 事件报告问题。组件控制器的 `exportAs("xlsx")` 与 `exportAs("excel")` 等价。

应用入口一次配置，所有预览实例沿用；preset、路由覆盖按字段继承：

```ts
defineMachReportConfig({
  defaults: { xlsx: { valueMode: "raw", paperSize: "auto" } }
});
```

`valueMode` 支持 text/raw；未指定时 wide 为 raw，普通页面为 text，显式值优先。`sheetMode` 默认 auto，`paperSize` 支持 auto/a3/a4/a5，默认 auto。方向由源页宽高决定。导出启动时复制配置，同一任务不会因路由配置变化而改变输出。

原生浏览器接入可以把 `buffer` 传入 Blob，MIME 使用 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`，下载结束后释放 Object URL。导出告警应交给用户或日志处理，不应当作已完整保留所有内容。

## 原始数值与格式

2.2 起，分页列表在 `GridCell.value` 保留原始数值、字符串、布尔和 null，`numberFormat` 保留声明的数字/百分比格式，小计与总计也提供这些元数据。raw 模式直接使用它们；例如0保持数值0、false保持布尔、`"00123"`保持文本。百分比的底层值仍为分数：0.899配合 `0.00%` 显示89.90%，不会二次乘100。

手写静态网格可显式声明 `{ text: "12.500", value: 12.5, numberFormat: "0.000" }`。没有value的旧计划继续写显示文本，非有限数值回退文本并告警。Date和复杂对象不保存到value；默认不会把以等号开头的字符串变成公式。

不要把所有数字样式字符串自动转为数字：订单号、长整型ID、带前导零编码都应由上游提供字符串。已有JavaScript number丢失的精度无法由导出器恢复。业务接口若采用0–100比例，应按其真实单位声明格式，不要直接套用会乘100的fraction percent格式。

## 日期、公式或额外业务数据表

可以从业务原始数据建立额外的数据 Sheet，或修改返回的工作簿后重新序列化：

```ts
const { workbook } = await renderPlanToXlsx(plan);
const dataSheet = workbook.addWorksheet("原始数据");
dataSheet.addRow(["物料", "数量"]);
dataSheet.addRow(["物料 A", 3]); // 由业务明确提供数值类型
dataSheet.getColumn(2).numFmt = "0";

const updatedBuffer = await workbook.xlsx.writeBuffer();
await writeFile("report-with-data.xlsx", new Uint8Array(updatedBuffer));
```

修改 `workbook` 后必须重新调用 `writeBuffer()`；原先返回的 `buffer` 是修改前的快照。默认导出文本不会自动变成公式。

## 后续演进建议

连续列表已由逻辑表元数据支持。Excel 每张表最多 16,384 列、1,048,576 行，单元格最多 32,767 字符及 253 个换行；超过时明确报错，不截断数据。超过 Excel 最大列宽（255 字符单位）或行高（409 pt）时，保留完整值、适配显示尺寸并返回告警。这些是 [Excel 自身的规格](https://support.microsoft.com/en-us/excel/excel-specifications-and-limits)，不限制宽表预览的总列宽。

严格坐标保真与大数据流式输出仍可独立扩展；整本工作簿与完整计划仍占内存，预览窗口化不代表导出恒定内存。页面展示值与原始数值已经分开，公式、工作簿编辑和原生日期仍由业务明确提供。具体优先级见[项目评审](./PROJECT_REVIEW.md)。
