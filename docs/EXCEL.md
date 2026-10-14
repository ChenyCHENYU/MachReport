# Excel 导出指南

MachReport 支持生成真正的 `.xlsx` 工作簿。入口是 `@agile-team/mach-report/xlsx`，Vue 预览工具栏也提供「导出 Excel」。默认保留显示文本，`valueMode: "raw"` 可保留列表原始数值、文本编号、布尔和空值，形成可继续计算的 Excel 表格。

## 能力矩阵

| 能力 | 当前支持 | 边界 |
| --- | --- | --- |
| 工作簿 | 每个 `RenderPlan.pages` 元素生成一张 Sheet | 不自动拼成连续数据 Sheet |
| 表格 | 表头、明细、分组、小计、总计 | 汇总已在分页时计算，不生成 Excel 公式 |
| 尺寸与合并 | 列宽、行高、`colSpan` / `rowSpan` | 越界跨度裁剪在当前网格内；同 Sheet 的网格共用列宽 |
| 标题 | 合并到当前页表格的实际列数 | 纯文本页使用单列，绝对坐标转为组件顺序 |
| 字体与样式 | 共享字号规则、字体族、加粗/斜体/下划线、颜色、水平/垂直对齐、换行、底色、边框开关/颜色 | 边框线型为细线，不映射旋转、透明度等 |
| 单元格值 | text 模式写显示文本；raw 模式写原始 primitive 和数字格式 | Date/对象回退显示文本，不猜数字字符串 |
| 图片与复杂内容 | 返回跳过告警 | 图片、条码、二维码、图表、嵌套组件、无文本回退的富文本等未导出 |
| 打印配置 | auto 识别 A3/A4/A5，也可显式 paperSize | 自定义尺寸回退 A4 并告警；不是 PDF 坐标复刻 |
| 运行环境 | 浏览器、Node.js | 整本工作簿在内存中生成，暂无流式输出或取消接口 |

没有 Excel 模板导入、在线工作簿编辑器、透视表或公式计算 API。主入口不加载 ExcelJS；实现与类型随 `/xlsx` 子入口发布。公开 `workbook` 保留 ExcelJS API，Node 类型依赖用于其 stream 签名。

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

`sheetName` 使用从 `0` 开始的页索引。名称需要唯一并满足 Excel 工作表命名规则；默认名称为 `Sheet1`、`Sheet2` 等。

## 浏览器和 Vue

Vue 工具栏会动态加载 `/xlsx`，创建下载并通过 `warning` / `error` 事件报告问题。组件控制器的 `exportAs("xlsx")` 与 `exportAs("excel")` 等价。

应用入口一次配置，所有预览实例沿用；preset、路由覆盖按字段继承：

```ts
defineMachReportConfig({
  defaults: { xlsx: { valueMode: "raw", paperSize: "auto" } }
});
```

`valueMode` 支持 text/raw，默认 text 兼容旧行为；`paperSize` 支持 auto/a3/a4/a5，默认 auto。方向由原页面宽高决定。导出启动时复制配置，同一任务不会因路由配置变化而改变输出。

原生浏览器接入可以把 `buffer` 传入 Blob，MIME 使用 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`，下载结束后释放 Object URL。导出告警应交给用户或日志处理，不应当作已完整保留所有内容。

## 原始数值与格式

2.2 起，分页列表在 `GridCell.value` 保留原始数值、字符串、布尔和 null，`numberFormat` 保留声明的数字/百分比格式，小计与总计也提供这些元数据。raw 模式直接使用它们；例如0保持数值0、false保持布尔、`"00123"`保持文本。百分比的底层值仍为分数：0.899配合 `0.00%` 显示89.90%，不会二次乘100。

手写静态网格可显式声明 `{ text: "12.500", value: 12.5, numberFormat: "0.000" }`。没有value的旧计划继续写显示文本，非有限数值回退文本并告警。Date和复杂对象不保存到value；默认不会把以等号开头的字符串变成公式。

不要把所有数字样式字符串自动转为数字：订单号、长整型ID、带前导零编码都应由上游提供字符串。已有JavaScript number丢失的精度无法由导出器恢复。业务接口若采用0–100比例，应按其真实单位声明格式，不要直接套用会乘100的fraction percent格式。

## 日期、公式或连续数据表

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

持续数据Sheet、严格坐标保真及大数据流式输出可在显式模型上扩展。页面展示值与原始数值已经分开，公式、工作簿编辑和原生日期仍由业务明确提供。具体优先级见[项目评审](./PROJECT_REVIEW.md)。
