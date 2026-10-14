# Excel 导出指南

MachReport 支持生成真正的 `.xlsx` 工作簿。入口是 `@agile-team/mach-report/xlsx`，Vue 预览工具栏也提供「导出 Excel」。当前定位是**将已排版的页面报表转成可编辑的文本型 Excel 表格**。

## 能力矩阵

| 能力 | 当前支持 | 边界 |
| --- | --- | --- |
| 工作簿 | 每个 `RenderPlan.pages` 元素生成一张 Sheet | 不自动拼成连续数据 Sheet |
| 表格 | 表头、明细、分组、小计、总计的渲染文本 | 汇总已在分页时计算，不生成 Excel 公式 |
| 尺寸与合并 | 列宽、行高、`colSpan` / `rowSpan` | 越界跨度裁剪在当前网格内；同 Sheet 的网格共用列宽 |
| 标题 | 合并到当前页表格的实际列数 | 纯文本页使用单列，绝对坐标转为组件顺序 |
| 字体与样式 | 字号、加粗、六位 HEX 颜色、水平对齐、单元格底色、细边框 | 不完整映射字体族、边框规则、旋转、透明度等 |
| 单元格值 | 格式化后的字符串 | `number` / `Date` / `boolean` 原始类型不保留 |
| 图片与复杂内容 | 返回跳过告警 | 图片、条码、二维码、图表、嵌套组件、无文本回退的富文本等未导出 |
| 打印配置 | A4，依据页面宽高判断横纵方向 | 不承诺其他纸张或 PDF 的坐标保真 |
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
  sheetName: (pageIndex) => `出库明细${pageIndex + 1}`
});

console.warn([...paginationWarnings, ...exportWarnings]);
await writeFile("report.xlsx", new Uint8Array(buffer));
```

`sheetName` 使用从 `0` 开始的页索引。名称需要唯一并满足 Excel 工作表命名规则；默认名称为 `Sheet1`、`Sheet2` 等。

## 浏览器和 Vue

Vue 工具栏会动态加载 `/xlsx`，创建下载并通过 `warning` / `error` 事件报告问题。组件控制器的 `exportAs("xlsx")` 与 `exportAs("excel")` 等价。

原生浏览器接入可以把 `buffer` 传入 Blob，MIME 使用 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`，下载结束后释放 Object URL。导出告警应交给用户或日志处理，不应当作已完整保留所有内容。

## 需要原生数字、日期或连续数据表时

`RenderPlan` 是面向展示的模型，已经丢失原始业务值的类型。不要将所有数字样式的字符串自动转为数字：订单号、长整型 ID、带前导零的编码都会受到影响。

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

优先增加独立的数据导出模型，显式描述字段类型、数字格式和 Sheet 分组，再考虑大数据流式输出。页面模型继续服务预览与打印，避免让同一份格式化文本同时承担展示、计算和模板编辑三种职责。具体优先级见[项目评审](./PROJECT_REVIEW.md)。
