# 模板设计器

`@agile-team/mach-report/designer` 是可选 Vue 入口。它复用模板文档、校验器与现有预览，维护可读的属性和 JSON；常规报表预览无需引入此入口。

```vue
<script setup lang="ts">
import { ref } from "vue";
import { ReportTemplateEditor, type TemplateEditorOptions } from "@agile-team/mach-report/designer";
import { defineReportTemplate, createTableTemplate } from "@agile-team/mach-report";
import "@agile-team/mach-report/vue/style.css";

const document = ref(defineReportTemplate({
  id: "outbound", name: "出库单",
  template: createTableTemplate({ columns: [{ field: "name", header: "物料" }] })
}));
const datasets = { detail: [{ name: "示例物料" }] };
// templateApi 使用项目已有请求客户端，服务端必须核对 expectedRevision。
const save: TemplateEditorOptions["save"] = (draft, { expectedRevision, signal }) =>
  templateApi.saveDraft(draft, { expectedRevision: expectedRevision ?? null, signal });
</script>

<template>
  <ReportTemplateEditor v-model="document" :datasets="datasets" :save="save" />
</template>
```

## 集成契约

| 属性 / 事件 | 作用 |
| --- | --- |
| `modelValue` / `v-model` | 经过 `defineReportTemplate` / `parseReportTemplate` 校验的文档；编辑有效时发出独立快照 |
| `datasets` | 显式预览数据；编辑器不查询业务接口，不把模板参数面板作为预览前置条件 |
| `dataSchemas` / `bindingDatasets` | 可选字段契约与绑定目录，供公式字段选择、Excel映射和验收共用 |
| `bindingSession` / `excel-bound` | 可重开的Excel绑定会话；仅模板替换确认成功后发出绑定事件 |
| `save(document, context)` | 返回服务端保存后的文档；`context` 包含 `expectedRevision` 与 `signal` |
| `readonly` | 禁止属性、JSON、恢复和保存；预览仍可阅读 |
| `messages` | 覆盖 `TEMPLATE_EDITOR_MESSAGES` 文案 |
| `preview` | 可选预览theme / toolbar / assets / pdfFontUrl和输出开关；默认浅色阅读预览，关闭导出 / 打印 / PDF窗口 |
| `saved` | 保存成功后返回新文档，包括服务端修订号 |
| `beforeDiscard(context)` | 可选宿主确认钩子，返回 `true` 才允许丢弃；未提供时显示内置确认。`reason` 为 `reset` / `replace`，包含独立草稿快照、可选替换文档和 `pendingLocalChanges: true` |

属性面板以单行“字段 / 组件 / 模板 / 工具 / 高级”导航组织内容。默认直接呈现当前字段的内容、格式与允许编辑开关：列宽与语义并排，对齐使用带说明的图标分段控件；无需先滚过字段目录再找属性。当前字段卡保留字段名、业务字段、位置与前后切换，顶部集中撤销、重做、恢复和保存。右侧预览独立伸缩，底部分页保持可见。

点击“字段目录”按需展开左栏内目录，支持搜索、勾选和批量对齐，不占用默认表单空间。搜索仅筛选目录；搜索框支持 Enter 选择当前候选、↑ / ↓ 进入结果，结果内 Home / End 快速到首末列。点击或 Enter 才选中一列并返回属性。Esc 只收起目录并归还入口焦点，点击或 Tab 移到目录外部会收起且不抢焦点；取消挑选保留原活动字段，物理字段索引保持不变。勾选仅用于批量操作，不切换当前字段；切换分区保留搜索和勾选，重新打开可继续定位。

“模板”集中名称与两行说明，标识与修订收进可展开的技术信息；“高级”才挂载完整 JSON 编辑区，并使用剩余面板高度。

属性面板支持模板名称 / 说明、多列表区域选择、字段、列宽、语义、正文对齐、表头对齐与可编辑开关。宽表列宽变化同步自然宽度；导入的合并表头同步物理表头样式与文字。内部预览固定只读并关闭另行导入，避免脱离当前模板草稿；需要验收输出时可显式配置`preview`，中文PDF同时提供字体。

百列宽表可按中文列名或业务字段搜索。搜索仅筛选面板，不改变模板列顺序；勾选列后可批量设置正文 / 表头对齐，整个批量操作可一次撤销。跨列合并表头是一个物理单元格，对齐变更会同步覆盖该合并范围。选择另一个明细区域会清空勾选，防止误改其他表。

属性、应用 JSON、批量对齐均支持撤销 / 重做。历史采用周期检查点与可逆字符串增量，最多100帧、16MiB，频繁小修改不再为每一步保留整份大JSON。剪枝先重建新基线；单帧超预算仅保留当前帧。保存或载入其他文档重置历史，撤销不会回退服务端修订号。

高级 JSON 必须经过校验后才能应用；ID 与修订号不能通过 JSON 偷换。尚未应用的 JSON 会暂停属性修改与保存，避免保存时丢弃正在输入的文本，可通过应用或撤销继续。无效属性保留在编辑面板并显示具体路径，暂停预览与保存；服务端冲突保留草稿，恢复按钮还原最近一次成功保存或外部载入的文档。`v-model` 回显不会把尚未保存的修改误当作已保存。

恢复草稿和外部文档替换均保护未保存属性、无效字段、尚未应用的 JSON、规则表单与 Excel 绑定配置：默认内置确认支持 Escape 继续编辑；也可用 `beforeDiscard` 连接项目统一确认框。钩子拒绝、抛错、过期请求或等待期间草稿发生变化均保留当前内容。外部替换被拒绝时，会回传当前有效草稿使 `v-model` 恢复一致；无效草稿不冒充有效文档发出。

组件 ref 暴露 `TemplateEditorController`：`pendingLocalChanges` 包含模板修改和工具中未应用的本地配置，`guardChanges()` 可接宿主路由离开保护，返回 `true` 后再导航。可选只读状态 `saving` / `blocked` 表示保存或确认正在进行，宿主可用其锁定切换模板、新建、关闭等跨模板动作；这些状态不要求新增适配器，也不改变 `readonly` 的禁止编辑语义。浏览器原生卸载不弹自定义异步确认，也不承诺能在卸载后保存草稿。

```ts
import { ref } from "vue";
import type { TemplateEditorController } from "@agile-team/mach-report/designer";
const editor = ref<TemplateEditorController>();
// 在项目已有的路由离开钩子中调用；对应组件使用 ref="editor"。
async function canLeave() { return await editor.value?.guardChanges() ?? true; }
```

新外部版本、卸载会取消旧保存；即使接口忽略取消，旧响应也不会覆盖当前文档。取消前已完成的服务端提交仍需通过重新读取确认，前端不把取消等同于数据库回滚。

## 版本与持久化

宿主可直接把保存接口接到 [createTemplateManager](./TEMPLATE_MANAGEMENT.md)。新文档的预期版本为 `null`，已有文档提交当前修订号；存储器保证状态更新和发布历史的原子 CAS。内存适配器只适合示例和测试。

## 画布与按需工具

“设计 / 预览”切换保留原属性面板与阅读预览。设计画布使用毫米几何：文本、明细、图片、矩形可添加、复制、删除、调整层级；拖动 / 缩放显示边缘和中心吸附线，键盘方向键微调，Escape取消。拖动中的位置使用局部样式与requestAnimationFrame更新，松手才校验并提交一个事务，撤销不会生成上百个鼠标帧。

画布提供适宽、适页与选区缩放；选择组件或字段目录中的列时将对应位置滚入视口，宽表额外提供轻量横向导航。Ctrl / Command / Shift 点击可多选，同一页的可移动组件支持六向对齐和水平 / 垂直等距，整次排列只产生一个撤销事务。位置锁定阻止鼠标、键盘与几何面板变更；锁属于当前设计会话，不写入业务模板，重新打开或撤销 / 重做后解除，避免历史结构变更将锁错绑到其他组件。

为保持画布交互轻量，设计态明细展示3条样例，静态网格最多展示2000格并明确提示；样例复用正式输出的语义对齐、数值格式、条件样式与表头优先级，空值留白、真实零保留；样例不执行分组或全量计算，完整阅读预览与导出仍使用完整数据。图片上传限制4MiB，支持PNG/JPEG/WebP/SVG；项目也可提供受控资源地址。

明细支持列宽拖动、列顺序 / 显隐、多层表头合并与拆分。合并前验证连续区域和已有跨度，不静默破坏原表头。图片使用项目受控资源地址，不在模板中嵌入任意脚本。只读模式关闭所有写入入口。

“工具”提供全宽、按需加载的[Excel业务绑定](./EXCEL_BINDING.md)、[计算与规则](./COMPLEX_REPORTS.md)、[变更与验收](./PUBLICATION_REVIEW.md)，避免把复杂表单堆进窄属性栏。Excel 向导以一个工作簿会话复用首次解析，切换 Sheet 不重复解压和载入，并在应用前保留各 Sheet 的区域和字段配置；应用只采用当前 Sheet，其他候选配置随此次应用结束。更换文件成功、切换只读或卸载时释放工作簿，取消和过期结果不覆盖原来源。底层 ExcelJS 已开始的 CPU 解析不能强行中断，但取消后不会继续转换或提交晚到结果。

规则工作台按目录、紧凑编辑区与结果解释侧栏组织。目录搜索字段名、中文名称、显式类型、单位和精度，最多显示 50 个候选，继续搜索可定位其余字段。验算按按钮执行，解释展示“源值 → 表达式 → 结果”、空值与除零策略，最多显示 5 条结果。修改规则或样例数据后旧验算被清除。主从与矩阵表单切换、工具和属性分区切换保留未应用配置；切换明细区域前保护当前规则草稿。“恢复工具草稿”放弃当前工具的未应用配置，模板保存要求先应用或恢复工具草稿。宿主替换被拒绝时，Excel 向导保持未应用状态，不显示成功。

变更验收分别追踪文档、上一版本、数据内容、字段契约、输出格式、样本范围和兼容确认的修订；任一输入变化立即标记“待复验”，隐藏旧通过摘要。兼容确认只绑定当前文档和上一版本，二者变化时清除勾选；样例数据、字段契约或格式变化保留勾选但仍需复验。结果明确展示上次实际检查的数据集数、行数和选择范围，结构检查不会宣称已验证全量排版；样例检查不代替服务端真实文件发布验收。

字段映射和可编辑范围仍须符合业务API契约与权限；界面开关不授予后台写权限。画布不是完整Excel应用，宏、任意脚本、完整Excel公式重算和审批控制台不包含在此入口。

启动 `pnpm --filter @agile-team/example-minimal dev` 后访问 `http://localhost:8610/designer.html`。示例使用明确标识的本地数据与内存存储，不连接业务数据库。

## 查询参数、模板库与批量生成

工具中的“查询参数”使用可视化表单维护模板参数；支持排序、必填、默认值、边界与选择项。未应用参数草稿参与离开保护，应用复用模板事务、撤销/重做与版本保存。详见[参数](PARAMETERS.md)。

可选 `ReportTemplateLibrary` 接收一个 `ReportTemplateCatalogProvider`：包内处理搜索/分类、远程分页、取消和过期响应，`open` 返回经过校验的独立模板文档。仅提供真实 `create(document,{signal})` 保存动作后显示复制入口，副本使用新 ID 并清除原修订；持久化与权限由宿主服务处理。库不持有企业账号。

```vue
<ReportTemplateLibrary :provider="catalogApi" :create="createDraft" @open="openDocument" />
<ReportBatchPanel :param-defs="paramDefs" :execute="generateInstance" @open-instance="openReceipt" />
```

批量面板复用查询参数控件，执行前校验所有待运行组；详细契约见[批量生成](BATCH_GENERATION.md)。模板库、设计器、发布与实例的可运行闭环在 `/platform.html`，使用本地有界内存参考适配器。生产存储和后续后端路线见[产品能力](PRODUCT_PLATFORM.md)。

Excel 多区域模板的原始行带、物理列槽位和页尾由绑定配方管理。该页的几何拖动、列宽/顺序/显隐、组件增删及表头结构变更会禁用，并提供回到 Excel 向导的入口；字段、对齐、数值格式、文本样式和业务规则仍可维护。这样不会把预览改成与 Excel 输出不同的结构。自由排版模板不受此限制。
