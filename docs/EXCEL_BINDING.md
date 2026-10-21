# Excel 业务绑定

将业务提供的 `.xlsx` 样式模板，转换为可重复取数的 MachReport 模板。来源文件只参与设计；明细数据由宿主数据集提供。

## 选择绑定方式

同一向导提供两种明确的模型，旧模板与旧会话保持兼容：

| 方式 | 适用场景 | 布局语义 |
| --- | --- | --- |
| 多区域绑定（recipe `2.0`） | 同 Sheet 多来源、顶部产量指标＋下方成本清单、局部单记录 | 每区独立的数据集、主键与字段映射；纵向扩展后，下方静态内容和后续区域自动顺延 |
| 传统整表（recipe `1.0`） | 一份数据集填充整张明细表 | 完整列宽，标题／表头／明细／静态尾页顺序相邻；尾页仍是独立页面 |

### 多区域绑定

1. 选择文件和工作表，切换「多区域绑定」。
2. 点击原始网格的起始单元格，Shift 点击终点，或使用键盘 Enter、Shift＋方向键；点击「创建区域」。原始预览仍是有界窗口，不生成整工作簿 DOM。
3. 为每个区域选择「单记录」或「纵向重复」，指定数据集、稳定业务主键和逐列映射。区域目录可在多组绑定之间切换，不清空另一组的草稿。
4. 需要表头时选择紧接原型上方的等宽矩形，点击「选区作为表头」。纵向重复区域的表头在分页后重复，连续 Excel 仅保留一次。
5. 需要每页页尾时，选择来源最后几行的完整列宽，点击「选区作为页尾」。分页引擎在每页为它预留空间。
6. 区域目录实时显示「就绪 / 待补齐 / 需修正」及问题数；底部用一句话说明下一步。点击「校验绑定」按需展开问题，点击某项会自动切换区域、跳转原始范围和字段分页，并聚焦对应配置，无需手工对照 JSON 路径。只读状态也能校验和定位，不会改写草稿。
7. 校验并使用后仍经过宿主的 `accept` 和已有未保存修改保护，拒绝替换不会显示已应用状态。

单记录区域接收零或一行数据；零行保留空白结构且不伪造业务主键，多行输入明确失败。纵向重复区域每个数据行替换一行原型，按真实行高分页；它必须独占自己的纵向带，不能在旁列放非空静态内容或并排放另一重复区域。局部单记录可以保留旁列静态标签，也可与另一单记录并排；并排区域需使用相同的起止行（包含表头）。

### 传统整表流程

1. 选择 Excel 文件和工作表，检查原始内容、合并表头和导入提示。
2. 点击行号选择行；使用 Shift 点击、拖动或键盘 Shift + ↑ / ↓ 扩展。分别标记标题、多层表头、样例明细和可选静态尾页。
3. 选择宿主提供的数据集契约，逐个物理列选择业务字段，并明确选择稳定业务主键。
4. 检查覆盖率、类型、单位、精度和样例值；校验问题可点击定位到字段或区域，修正后生成独立模板。
5. 保存模板文档；若需要继续调整绑定，同时保存绑定会话，重新传入即可恢复原始参数和来源预览。

不会根据相似表头自动提交业务映射；数据集、字段、区域与业务主键都需要明确选择。数据集切换会清除旧映射，防止沿用另一套接口字段。

## Vue 最小接入

```vue
<script setup lang="ts">
import {
  ExcelBindingWizard,
  type ExcelBindingWizardApply,
} from "@agile-team/mach-report/designer";
import type { ExcelBindingDataset } from "@agile-team/mach-report/xlsx";

const datasets: ExcelBindingDataset[] = [
  {
    id: "production",
    label: "生产实绩",
    fields: [
      {
        field: "heat",
        label: "炉号",
        type: "text",
        semanticRole: "identifier",
      },
      {
        field: "weight",
        label: "产重",
        type: "number",
        unit: "kg",
        digits: 3,
        sample: 0,
      },
    ],
  },
];
function apply(result: ExcelBindingWizardApply) {
  // 交给现有模板管理服务保存；result.document 不包含原样例明细。
  // result.session 是可选的设计来源与绑定参数，单独保存并控制访问权限。
  console.log(result.document, result.session, result.warnings);
}
</script>
<template><ExcelBindingWizard :datasets="datasets" @apply="apply" /></template>
```

`readonly` 阻止上传、区域、映射与应用操作，保留来源和参数供查看。传入 `session` 可以恢复既有设计；`identity` 可预设新模板的标识和名称。`messages` 为独立可选文案，`importOptions` 可约束文件和工作表资源预算，或选择 `wide` / `a3` / `a4` 版式。

完整设计器可通过 `bindingDatasets` 配置同一个向导。设计器应用新文档时仍经过未保存修改保护，不绕过保存服务的修订控制。

## Node 与浏览器共用

`/xlsx` 的纯函数不依赖 Vue，也不请求接口或写入数据库。

### 同 Sheet 多区域、多数据集

以下 `A3:L3` 为一条产量记录，`A5:L5` 为成本明细原型，`A4:L4` 为成本表头；每个来源区域按自身的字段契约填充。示例中的 12 个字段必须与真实接口契约逐项核对，不能通过相似表头猜测。

```ts
import {
  importExcelTemplate, createExcelRegionBindingDocument,
  createExcelRegionBindingSession, parseExcelRegionBindingSession,
  validateExcelRegionBindings, type ExcelRegionBindingRecipe,
} from "@agile-team/mach-report/xlsx";

const imported = await importExcelTemplate(bytes, { sheets: ["W4"], layout: "wide" });
const recipe: ExcelRegionBindingRecipe = {
  version: "2.0", sheet: "W4",
  regions: [
    { id: "production", range: "A3:L3", mode: "record", dataset: "production", rowKey: "id", fields: productionFields },
    { id: "cost", range: "A5:L5", headerRange: "A4:L4", mode: "repeat", dataset: "cost", rowKey: "id", fields: costFields },
  ],
  footerRange: "A6:L6",
};
const validation = validateExcelRegionBindings(imported, recipe, datasets);
if (!validation.ok) throw new Error(validation.issues.map(x => `${x.path}: ${x.message}`).join("\n"));
const identity = { id: "w4", name: "成本日报" };
const { document, warnings } = createExcelRegionBindingDocument(imported, recipe, datasets, identity);
const session = createExcelRegionBindingSession(imported, recipe, identity);
const restored = parseExcelRegionBindingSession(JSON.stringify(session));
// 注册 document.template；查询时提供 { production: [...], cost: [...] }。
```

多区域编译成普通列表、静态网格和显式 `page.flow` 带状排版；同一模板可在浏览器、Worker 或后端 Node 的公共排版入口执行，使用侧无需手算下面区域的位置。每个区域的 `rowKey`、`revisionField`、`sourceTokenField` 都只引用其自身数据集；字段缺失和重复身份仍由数据契约与分页检查。生成列缺省只读，开启预览编辑并不自动开放绑定字段，后续按明确业务规则配置编辑权限。导入的公式不会转换成可写的计算输入。

`auto` / `continuous` Excel 输出识别编译器生成且经过几何核验的区域标记，将分页结果接回同一 Sheet，保留完整物理列位置、旁列静态内容、合并单元格、真实零值和数值类型。重复区域表头、每页页尾在连续 Sheet 只保留一次；`sheetMode: "pages"` 明确保留每页结构。单页的几何合成在分配前限制为 100 万格，超限精确拒绝并提示缩小分页高度或列数；不靠截列、裁剪内容或覆盖同位单元格通过。

### 传统整表 API（保持兼容）

```ts
import {
  importExcelTemplate,
  validateExcelBindingRecipe,
  createExcelBindingDocument,
  createExcelBindingSession,
  parseExcelBindingSession,
  type ExcelBindingRecipe,
} from "@agile-team/mach-report/xlsx";

const imported = await importExcelTemplate(bytes, {
  sheets: ["日报"],
  layout: "wide",
});
const recipe: ExcelBindingRecipe = {
  version: "1.0",
  sheet: "日报",
  dataset: "production",
  rowKey: "heat",
  regions: { title: "A1:B1", header: "A2:B3", detail: "A4:B20" },
  fields: ["heat", "weight"],
};
const validation = validateExcelBindingRecipe(imported, recipe, datasets);
if (!validation.ok)
  throw new Error(
    validation.issues.map((x) => `${x.path}: ${x.message}`).join("\n"),
  );
const result = createExcelBindingDocument(imported, recipe, datasets, {
  id: "daily-v1",
  name: "生产日报",
});
const session = createExcelBindingSession(imported, recipe, {
  id: "daily-v1",
  name: "生产日报",
});
const restored = parseExcelBindingSession(JSON.stringify(session));
```

`recipe` 可单独与来源资产标识存储。`session` 包含原始导入快照，因此也包含来源文件中的设计样例；它与发布给业务查询的 `document` 是两个独立对象。宿主负责存储权限、来源资产生命周期和实际接口取数，不应把接口返回的完整业务数据塞入会话。

## 传统整表规则与边界

| 规则     | 行为                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------- |
| 区域     | 完整列宽、顺序相邻、无重叠，完整覆盖来源；标题与静态尾页可省略                                           |
| 合并格   | 保留多层表头；切断合并边界或在动态明细原型中使用合并格时拒绝编译                                         |
| 字段     | 每个物理列显式映射一个已声明字段；重复、未知和未映射字段报告精确路径                                     |
| 主键     | 选择契约中稳定的文本或数字字段，不能使用展示行号；提供契约样例时检查重复、缺失和类型                     |
| 精度     | 数值 `digits` 以业务契约为准，不继承样例格格式；`decimal` 精确小数保留文本，避免浮点转换                 |
| 空值 / 0 | 不注入默认 0，不把样例填进真实查询；真实 0 按明确精度显示                                                |
| 静态尾页 | 保留为独立后续页面，不充当每页页脚；Excel 默认 `auto` 保留独立 Sheet。该尾页不适用强制 `continuous` 合并 |
| 公式     | 不执行宏、脚本、外链或公式重算；沿用 Excel 导入的已保存显示值与只读约束                                  |
| 新模板   | 只编译所选工作表，不把其他未绑定工作表的样例带进结果；不隐式覆盖既有模板                                 |

字段契约可以提供最多 100 行代表性 `samples` 进行只读验证（最多 200,000 个字段值）；这些样例用于检查类型、主键和映射，不作为报表实时结果。没有样例时仍能校验结构，实际查询数据应继续走公共数据契约校验。

## 多区域支持边界

- 每份 recipe 选择一个 Sheet，最多 128 个动态区域；同一预览中的多个业务来源由各区域显式引用数据集。
- 动态区域原型是一行，列范围可局部选择；原型内不支持合并格。区域表头可多行合并，所有选区都必须完整包含跨越边界的合并单元格。
- 只支持垂直扩展。横向扩展、嵌套重复、同排并行重复、下方区域与上方区域重叠、旁列存在非空内容的重复区，在编译前给出精确错误。
- 不绑定的来源内容视为静态模板内容并完整保留；只有明确选中的原型值会被移除。不要把真实业务明细当作未绑定静态区域发布。
- 基础字体、颜色、边框和几何来自原型；内容对齐和数值精度按业务字段契约生成，可在设计器字段属性中进一步明确设置。精确 `decimal` 继续保留文本，不转换为浮点数。
- 不执行 Excel 公式、宏、外部连接或隐藏脚本。完整电子表格交互和任意 Excel 工作簿无损迁移不属于此绑定模型。
- 向导复用已有 `openExcelWorkbook` 会话；切 Sheet 不重复解析 ZIP。两种模式与各工作表的绑定草稿分别保留，更换文件、只读和卸载仍遵循原有取消／生命周期约束。

## 资源和交互

原始预览默认只生成 **24 行 × 12 列**的双向窗口，导航更换窗口。合并格跨窗口时显示其可见片段和原锚点地址，不渲染整工作簿 DOM。逐列映射每组最多 12 列，字段与原始工作表始终按物理列索引对应。

问题列表每组最多 12 项，展开后可翻页查看；定位只切换现有窗口，不挂载整张工作表或所有字段。字段候选仍限制为 64 项并保留当前已选映射，输入名称、编码或单位可继续检索。区域状态和定位由包内处理，不要求宿主额外传入路径解析或焦点控制函数。

Excel 解析模块在上传时异步加载。向导先检查工作簿元数据，再仅转换所选工作表；源 ZIP、文件和工作表总量的硬预检仍然执行。原有 `importExcelTemplate` 默认多表导入行为保持不变。更换文件、取消或卸载后，过期解析结果不会覆盖当前工作表；切换为只读也会终止当前提交。ZIP、文件、行列和单元格预算继续由既有导入预检执行。绑定会话复用模板 JSON 的安全检查，拒绝特殊对象、访问器、危险键和无界会话文本。

示例入口：`examples/minimal/excel-binding.html`。验证包括真实 `.xlsx` 导入、图形选区、稳定主键、样例排除、精度、会话恢复、只读与大表窗口；不需要数据库或业务鉴权。
