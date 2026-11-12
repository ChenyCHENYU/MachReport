# Excel 模板导入

`@agile-team/mach-report/xlsx` 的 `importExcelTemplate()` 把 `.xlsx` 工作簿转换为普通 `ReportTemplate`。之后沿用同一套预览、单元格编辑、打印和导出能力；业务侧无需解析工作簿或手算列宽、行高与合并区域。

## 最小接入

只查看工作簿时直接导入；将业务原型变成接口驱动模板时，单数据集整表可调用 `bindExcelTemplate`，同 Sheet 多来源和局部区域使用 `createExcelRegionBindingDocument`（recipe `2.0`）。二者分开，避免误把样例行当作真实业务数据。

[Excel 业务绑定](./EXCEL_BINDING.md)提供可操作向导、`A3:L3` 产量单记录＋`A5:L5` 成本重复区的完整示例、每页页尾和连续 Excel 回读语义。旧 `bindExcelTemplate` 和 recipe `1.0` 的完整列宽／静态尾页行为保持兼容；多区域是独立版本模型，不是简单放宽旧整表校验。

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
| 基础样式 | 映射字体、字号、字重、颜色、底色、对齐、换行与边框；标准索引色0–63保留，系统色/未知色明确告警 |
| Logo / 图片 | 选区内的原生PNG/JPEG drawing保留实际位置、尺寸与字节，Excel回写不插入额外数据行 |
| 数字格式 | 保留格式元数据，支持的格式用于预览，原始值供 Excel 导出 |
| 公式 | 使用文件中的缓存结果，标为只读；不计算或访问外部引用，重导出为缓存值 |
| 日期 | 保留 Excel 日期序列与格式，使用毫秒精度；预览中保持只读 |
| 未支持内容 | `warnings` 继续兼容；`diagnostics` / `diagnosticSummary` 提供有界位置、稳定代码及准确总数 |

源单元格没有边框时，预览与导出保持无边框；显式单边、单元格级边框颜色和线宽由 DOM、Canvas、PDF 共用同一套几何，合并区域不会补出内部边线。共边只绘制一次，冲突时较粗边线优先，同粗按稳定的行列顺序处理。Excel 同一单元格四边使用不同线型或颜色时仍按单元格统一实线近似，并返回告警。

未声明水平对齐时，采用报表统一默认，文字居左，数字、日期与布尔居中。已声明数字格式的空格也预置居中，之后编辑数值无需再改样式。Excel 模板中明确指定的水平对齐优先，`@` 文本格式和字符串编号继续保持文本类型与左对齐。

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

## 反复选择 Sheet：一次解析，会话复用

设计器绑定向导默认使用包内工作簿会话。自建向导也可直接复用，界面只保存当前会话和选项：

```ts
import { openExcelWorkbook } from "@agile-team/mach-report/xlsx";

const session = await openExcelWorkbook(file, { signal, limits: { maxCells: 250_000 } });
try {
  const directory = session.inspect(); // 同步元数据，无二次解析
  const result = await session.importTemplate({ sheets: [directory.sheets[0]!.name] });
  // 切换 Sheet 时继续调用 session.importTemplate({ sheets: [...] })。
  // result 是独立模板；释放会话不会修改已经生成的结果。
} finally {
  session.dispose(); // 替换文件或界面卸载时释放
}
```

`limits` 在打开时固定，转换选项不接受它，避免切换 Sheet 时绕过源工作簿预算。一次会话同时只允许一个转换；失败或单次取消后可以重试，`dispose()` 会取消在途转换并拒绝后续操作。会话持有完整解析工作簿，宿主应在替换文件和卸载时释放，不建立全局无界文件缓存。标准设计器已处理这些生命周期。

ZIP 预检逐项、逐块检查 `signal`，取消会主动结束当前读取并停止后续条目；等待文件读取或第三方解析时可及时拒绝并隔离迟到结果。第三方解析中已经开始的同步 CPU 工作不能被主线程抢占；需要硬取消时在受控 Worker 或后端执行。`onProgress` 保持已转换 Sheet 数 / 选中 Sheet 总数的含义，预检不会混入这个进度。

## 持久化和业务闭环

小模板可用 `defineReportTemplate()` 和 `serializeReportTemplate()` 保存版本化 JSON。模板文档 API 另有 200,000 个 JSON 节点与 1,000 万字符的校验预算，大 Excel 展开后的模板可能超过该预算；导入成功不代表一定可序列化为受管模板文档。大模板建议保存原始 `.xlsx`、导入参数和版本，在受控环境转换后分页展示。模板名称、修订、文件来源、权限和审批由应用维护。选择文件与转换本身不会上传文件、修改数据库或执行工作簿中的代码。

模板中的编辑是本次预览计划的修改。需要持久化时，应用应提供保存函数，绑定明确的业务键，校验字段权限与封月状态，并在保存成功后确认编辑；导入不自动为静态单元格生成安全的业务写接口。

## 可视业务绑定向导

需要把业务提供的工作簿转换为可复用数据模板时，可使用 `/designer` 的 `ExcelBindingWizard`，或设计器“工具 → Excel绑定”。向导先读取Sheet元数据，再导入选定Sheet；通过有界工作簿窗口标记标题、表头、明细、静态页尾，按字段契约绑定并生成模板。保存源与recipe可重开编辑，业务查询数据不写入编译模板。详见[Excel业务绑定](./EXCEL_BINDING.md)。

## 图片导入的边界

原生 PNG/JPEG 图片默认导入，无需开启额外开关。图片必须完整落在所选单元格范围和同一预览分段内；跨选区或分段时返回具名告警，可扩大 `range`、提高 `maxRowsPerPage` 或调整原模板。纯图片工作表应显式给出覆盖图片的单元格范围。媒体遵守[共享字节/像素预算](./QUALITY.md)，异常大图在解码前拒绝。

图片在设计器中调整位置后，Excel 导出会重新计算锚点，跨行移动也不会插入额外数据行；重复 Logo 共用媒体并保留独立组件身份。

图表对象、链接图片、裁剪/旋转/翻转及绘图形状会返回明确告警，不保证还原；应在Excel内转成普通PNG/JPEG图片后导入。格内混合字体转换为 `GridCell.richParagraphs`，保留片段文字、字体族、字号、粗斜体、单下划线和颜色，同时保留 `text` / `value` 作为纯文本回退。混合字体单元格保持只读，避免普通文本编辑覆盖原字面；删除线、上下标及特殊下划线等未支持格式继续返回告警。

## 结构化诊断与原始位置

`ExcelImportResult` 和 `ExcelWorkbookInspection` 兼容保留 `warnings: string[]`，同时提供可选的 `diagnostics`、`diagnosticSummary`。本版本的实际导入与检查都会返回这两个新字段；类型保持可选，便于旧结果、已有宿主适配器逐步接入。无需增加导入配置。

```ts
import {
  importExcelTemplate,
  type ExcelImportDiagnostic
} from "@agile-team/mach-report/xlsx";

const result = await importExcelTemplate(file);
const issues: readonly ExcelImportDiagnostic[] = result.diagnostics ?? [];
const total = result.diagnosticSummary?.total ?? 0;
const formulas = result.diagnosticSummary?.counts["formula-cached"] ?? 0;
const omitted = result.diagnosticSummary?.omitted ?? 0;
// result.template 与之前保持一致，可直接交给预览或绑定向导。
```

| 字段 | 约定 |
| --- | --- |
| `code` | 稳定的英文分类，类型为 `ExcelImportDiagnosticCode`；不应解析中文 `message` 判断类型 |
| `severity` | 当前为 `"warning"`；包含公式缓存、只读日期等使用说明，不表示文件导入失败 |
| `message` | 可展示的说明；旧 `warnings` 继续保留有界、去重的字符串提示 |
| `sheet` | 原始工作簿的精确 Sheet 名；不使用预览分段的页名替代 |
| `cell`、`row`、`column` | 原始 Excel 单元格地址及一基行列；合并格可由预览映射到其主格 |
| `range` | 原始或受影响范围。区域规则可能含多个矩形，存在可靠位置时另给 `cell` 作为定位锚点 |
| `part` | 仅能确定 OOXML 部件时给出的 ZIP 路径，例如 `xl/charts/chart1.xml`；不推断它属于哪个 Sheet |

定位字段按实际证据提供，不要求每条都具有单元格位置。比如工作簿宏、图表部件或图片变换预检可能只有 `part`；工作表保护可能只有 `sheet`。宿主应对缺少坐标的诊断显示说明或跳到对应 Sheet，不应构造假的格地址。标准预览和 Excel 绑定向导已接入具备位置的诊断，点击后按源 Sheet、选区、合并格和预览分段定位。

诊断默认最多保留 **200 条代表性明细**，不同分类尽量保留样本。`diagnosticSummary` 的 `total` 是实际发生次数，`counts` 按 `code` 准确累计，`omitted` 是未保留明细的次数；`entries` 与 `diagnostics` 对应。超过明细窗口后依然累计，不按明细条数估算总量。样式转换缓存也会为每个受影响源格记录正确位置，不会把所有问题归到首次命中的单元格。

常见分类包括 `formula-cached` / `formula-result-missing`、`date-readonly` / `number-format`、`style-color` / `style-alignment`、`conditional-format` / `data-validation`、`image-omitted` / `image-segment`、`chart` / `external-link`。完整可选值以导出类型为准。`warnings.length` 是去重后的兼容提示数，不能替代上述总量或分类计数。

工作簿会话复用 ZIP 预检的诊断摘要，每次 `importTemplate()` 独立累计当前选择的转换结果；切换范围或重复导入不会叠加上一次的告警。200 条明细窗口、既有 ZIP/解压/单元格预算和取消行为分别生效，结构化诊断不放宽安全预算。

### 六类生产报表结构回归

仓库增加了[生产项目列与指标结构快照](../packages/mach-report/src/__tests__/fixtures/production-report-structures.json)：五张日报分别为 55、66、70、82、39 列，晨会报表包含 40 项指标。快照仅保留列/指标元数据、来源摘要及映射状态分类，不包含业务取数表达式或实际生产数据。

[可重放测试](../packages/mach-report/src/__tests__/production-report-structures.test.ts)使用合成的 `0`、空值、`1`、前导零编号、长精度十进制文本和布尔值，经过实际 XLSX 编码导入、DOM 渲染、严格 PDF 编码与文本流回读，以及 XLSX 再编码回读。[真实浏览器回归](../e2e/production-report-structures.spec.ts)另查全部格的几何、对齐及文字溢出。

该语料是项目列/指标结构快照，源目录声明的工作簿名为《炼钢报表（涵逻辑）.xlsx》；原始工作簿本轮不在场。它不能替代原始《炼钢报表.xlsx》的逐格版式验收，也不确认 PL 字段映射、计量单位或业务计算口径。中文元数据保留在快照，渲染用拉丁字段编号，避免把字体覆盖率误当成业务结构验证结果。
