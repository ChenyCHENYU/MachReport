# Excel 业务绑定

将业务提供的 `.xlsx` 样式模板，转换为可重复取数的 MachReport 模板。来源文件只参与设计；明细数据由宿主数据集提供。

## 交互流程

1. 选择 Excel 文件和工作表，检查原始内容、合并表头和导入提示。
2. 点击行号选择行；使用 Shift 点击、拖动或键盘 Shift + ↑ / ↓ 扩展。分别标记标题、多层表头、样例明细和可选静态尾页。
3. 选择宿主提供的数据集契约，逐个物理列选择业务字段，并明确选择稳定业务主键。
4. 检查覆盖率、类型、单位、精度、样例值与错误路径，校验后生成独立模板。
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

## 规则与边界

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

## 资源和交互

原始预览默认只生成 **24 行 × 12 列**的双向窗口，导航更换窗口。合并格跨窗口时显示其可见片段和原锚点地址，不渲染整工作簿 DOM。逐列映射每组最多 12 列，字段与原始工作表始终按物理列索引对应。

Excel 解析模块在上传时异步加载。向导先检查工作簿元数据，再仅转换所选工作表；源 ZIP、文件和工作表总量的硬预检仍然执行。原有 `importExcelTemplate` 默认多表导入行为保持不变。更换文件、取消或卸载后，过期解析结果不会覆盖当前工作表；切换为只读也会终止当前提交。ZIP、文件、行列和单元格预算继续由既有导入预检执行。绑定会话复用模板 JSON 的安全检查，拒绝特殊对象、访问器、危险键和无界会话文本。

示例入口：`examples/minimal/excel-binding.html`。验证包括真实 `.xlsx` 导入、图形选区、稳定主键、样例排除、精度、会话恢复、只读与大表窗口；不需要数据库或业务鉴权。
