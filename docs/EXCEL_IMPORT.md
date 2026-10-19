# Excel 模板导入

`@agile-team/mach-report/xlsx` 的 `importExcelTemplate()` 把 `.xlsx` 工作簿转换为普通 `ReportTemplate`。之后沿用同一套预览、单元格编辑、打印和导出能力；业务侧无需解析工作簿或手算列宽、行高与合并区域。

## 最小接入

只查看工作簿时直接导入；将业务原型变成接口驱动模板时，导入后调用 `bindExcelTemplate`。二者分开，避免误把样例行当作真实业务数据。

### 显式业务区域绑定

```ts
import { importExcelTemplate, bindExcelTemplate } from "@agile-team/mach-report/xlsx";

const imported = await importExcelTemplate(file);
const bound = bindExcelTemplate(imported, [{
  sheet: "电炉日报", dataset: "heats",
  header: "A3:C4", detail: "A5:C5",
  columns: [
    { field: "heat", semanticRole: "identifier" },
    { field: "shift", semanticRole: "dimension" },
    { field: "weight", semanticRole: "measure", format: { kind: "number", digits: 3 } }
  ],
  rowKey: "heat", revisionField: "revision", sourceTokenField: "sourceToken"
}]);
// 注册bound.template，数据源返回 { heats: [...] }。
```

`sheet` 必须存在且每次只绑定一次；`header` 是完整列范围的A1坐标，可含多层合并表头；`columns` 按物理列逐项对应，可简写为字段名。`detail` 可选，省略则使用表头以下所有行；有显式末端时，后续静态页脚保留为独立页并返回告警。请按真实工作簿替换示例范围。

包内保留表头上方标题、合并表头与明细原型的基础样式，剔除样例数据，生成重复表头的普通列表；大批业务行走既有分页、连续Excel和编辑协议。跨区域合并、明细原型合并、不连续列或数量不匹配明确拒绝，不推断业务字段或默默截断结构。绑定后的空数据集仍保持表头；业务空态由预览的`emptyState`决定。

```ts
import { paginateTemplate } from "@agile-team/mach-report";
import { importExcelTemplate } from "@agile-team/mach-report/xlsx";

// 浏览器 File / Blob、ArrayBuffer 与 Uint8Array 均可。
const { template, sheets, warnings } = await importExcelTemplate(file);
const { plan } = paginateTemplate(template, {});
```

默认读取所有可见工作表，以完整列宽生成 wide 报表。列宽不会因 A4 页宽而压缩，纵向分段用于预览窗口化，合并单元格保持在同一段内。`sheets` 提供原始名称、序号、范围，以及在模板中的起始页和页数；工作表次序保持不变。

返回的是独立 JSON 模板，可直接用于 `createLocalFetcher()`、报表注册或模板管理：

```ts
import { createLocalFetcher } from "@agile-team/mach-report/vue";

const fetcher = createLocalFetcher({
  imported: { template, datasets: {} }
});
```

```vue
<MachReportPreview report-id="imported" :fetcher="fetcher" />
```

导入保留工作簿当时的内容。若导入文件中已经有数据，它们也会成为模板的静态值；包不会猜测哪些行是明细、哪些单元格对应后端字段，也不会从文件中建立新的业务接口。需要每次查询刷新数据时，应明确配置业务数据映射。

## 内容与版式

| 内容 | 行为 |
| --- | --- |
| 多工作表 | 默认导入所有可见 Sheet，可按名称或原始序号选择 |
| 表格 | 保留单元格文本、原始数值、布尔、空值和文本编号 |
| 几何 | 读取列宽、行高、跨行与跨列合并；宽表按自然宽度展开 |
| 基础样式 | 映射字体、字号、字重、颜色、底色、对齐、换行与边框 |
| 数字格式 | 保留格式元数据，支持的格式用于预览，原始值供 Excel 导出 |
| 公式 | 使用文件中的缓存结果，标为只读；不计算或访问外部引用，重导出为缓存值 |
| 日期 | 保留 Excel 日期序列与格式，使用毫秒精度；预览中保持只读 |
| 未支持内容 | 通过 `warnings` 报告，应用应展示或记录有意义的告警 |

源单元格没有边框时，预览与导出保持无边框；显式单边、单元格级边框颜色和线宽由 DOM、Canvas、PDF 共用同一套几何，合并区域不会补出内部边线。共边只绘制一次，冲突时较粗边线优先，同粗按稳定的行列顺序处理。Excel 同一单元格四边使用不同线型或颜色时仍按单元格统一实线近似，并返回告警。

未声明水平对齐时，沿用 Excel 的类型习惯：文字居左、数字和日期居右、布尔居中；已声明数字格式的空格也预置右对齐，之后编辑数值无需再改样式。显式对齐优先，`@` 文本格式和字符串编号不会因格式声明而转换为数字。

导入是工作表内容向报表模型的转换。图表、透视表、宏、条件格式计算、完整 Excel 公式引擎及工作簿界面不在这个 API 的范围内；旧版二进制 `.xls` 需要先转为 `.xlsx`。有公式但没有缓存结果时，显示空值并告警，不能把空值解释为计算结果 0。

普通单元格在开启预览编辑后可修改，公式和日期格保持只读。若工作簿启用了工作表保护，标记为 locked 的单元格也保持只读；应用自身的权限与封月规则仍需通过 `canEdit` 和服务端验证落实。

带公式的单元格不会因为打开 `editable` 而变为输入框。其他单元格的编辑也遵循[单元格编辑](./CELL_EDITING.md)的类型、校验、保存与只读规则。

## 选择工作表、范围与纸型

```ts
const result = await importExcelTemplate(file, {
  sheets: ["生产日报", 2], // 序号从 1 开始
  range: { "生产日报": "A1:CD120" },
  layout: "wide",
  maxRowsPerPage: 80
});

// 标准纸张选配：完整列宽等比适配，不丢弃右侧列。
const printable = await importExcelTemplate(file, {
  sheets: ["生产日报"],
  layout: "a3",
  landscape: true
});
```

`layout` 可选 `wide`、`a3`、`a4`，默认 `wide`。A3/A4 默认横向；列数较多时等比适配后的文字可能很小，应保留 wide 用于屏幕查阅。`range` 可以是一段对所有工作表生效的 A1 范围，也可以按精确 Sheet 名分别设置。指定范围需完整包含跨越边界的合并区域，避免把原始矩阵拆开。

## 文件与资源预算

导入会校验 ZIP 结构、压缩文件大小、声明的展开大小，以及选中范围的行、列、单元格和 Sheet 数量。超出预算会明确拒绝，不会静默截列或截行；减少 Sheet 或指定 `range` 后可重新导入。

| 预算 | 默认值 | 可配置上限 |
| --- | --- | --- |
| 压缩文件 | 20 MiB | 20 MiB |
| ZIP 实际展开总量 | 64 MiB | 64 MiB |
| 单元格 | 250,000 | 1,000,000 |
| 行 | 100,000 | Excel 上限 1,048,576 |
| 列 | 2,048 | Excel 上限 16,384 |
| Sheet | 32 | 32 |

`limits` 可为单次导入调整预算，不能关闭硬性安全上限。源工作簿也会在解析前检查资源范围，选择 `sheets` / `range` 不能绕过源文件预算；预算内的大工作簿可用这些选项缩小最终模板。完整工作簿解析与模板仍占内存，预览窗口化不等于工作簿解析或导出恒定内存。大文件宜明确限制业务范围，在专用 Worker 或受控后端执行转换，再交给页面展示。

安全 ZIP 预检需要支持 `DecompressionStream("deflate-raw")` 的现代浏览器或 Node.js 22+。旧环境会收到明确的兼容性错误，不会跳过展开检查；其余引擎和导出 API 的 Node.js 18+ 兼容约定保持不变。

纵向分段默认目标为 80 行，同时受每段 10,000 个单元格的约束；列很多时会自动减少每段行数。跨行合并保持完整，无法安全容纳的超大合并区域会明确拒绝，避免一次构建过量 DOM。

## 持久化和业务闭环

小模板可用 `defineReportTemplate()` 和 `serializeReportTemplate()` 保存版本化 JSON。模板文档 API 另有 200,000 个 JSON 节点与 1,000 万字符的校验预算，大 Excel 展开后的模板可能超过该预算；导入成功不代表一定可序列化为受管模板文档。大模板建议保存原始 `.xlsx`、导入参数和版本，在受控环境转换后分页展示。模板名称、修订、文件来源、权限和审批由应用维护。选择文件与转换本身不会上传文件、修改数据库或执行工作簿中的代码。

模板中的编辑是本次预览计划的修改。需要持久化时，应用应提供保存函数，绑定明确的业务键，校验字段权限与封月状态，并在保存成功后确认编辑；导入不自动为静态单元格生成安全的业务写接口。

## 可视业务绑定向导

需要把业务提供的工作簿转换为可复用数据模板时，可使用 `/designer` 的 `ExcelBindingWizard`，或设计器“工具 → Excel绑定”。向导先读取Sheet元数据，再导入选定Sheet；通过有界工作簿窗口标记标题、表头、明细、静态页尾，按字段契约绑定并生成模板。保存源与recipe可重开编辑，业务查询数据不写入编译模板。详见[Excel业务绑定](./EXCEL_BINDING.md)。
