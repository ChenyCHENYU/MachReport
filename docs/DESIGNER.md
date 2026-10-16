# 模板属性编辑器

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
| `save(document, context)` | 返回服务端保存后的文档；`context` 包含 `expectedRevision` 与 `signal` |
| `readonly` | 禁止属性、JSON、恢复和保存；预览仍可阅读 |
| `messages` | 覆盖 `TEMPLATE_EDITOR_MESSAGES` 文案 |
| `preview` | 可选预览theme / toolbar / assets / pdfFontUrl和输出开关；默认浅色阅读预览，关闭导出 / 打印 / PDF窗口 |
| `saved` | 保存成功后返回新文档，包括服务端修订号 |

属性面板支持模板名称 / 说明、多列表区域选择、字段、列宽、语义、正文对齐、表头对齐与可编辑开关。宽表列宽变化同步自然宽度；导入的合并表头同步物理表头样式与文字。内部预览固定只读并关闭另行导入，避免脱离当前模板草稿；需要验收输出时可显式配置`preview`，中文PDF同时提供字体。

高级 JSON 必须经过校验后才能应用；ID 与修订号不能通过 JSON 偷换。无效属性保留在编辑面板并显示具体路径，暂停预览与保存；服务端冲突保留草稿，恢复按钮还原最近一次成功保存或外部载入的文档。`v-model` 回显不会把尚未保存的修改误当作已保存。

新外部版本、卸载会取消旧保存；即使接口忽略取消，旧响应也不会覆盖当前文档。取消前已完成的服务端提交仍需通过重新读取确认，前端不把取消等同于数据库回滚。

## 版本与持久化

宿主可直接把保存接口接到 [createTemplateManager](./TEMPLATE_MANAGEMENT.md)。新文档的预期版本为 `null`，已有文档提交当前修订号；存储器保证状态更新和发布历史的原子 CAS。内存适配器只适合示例和测试。

该组件是轻量属性编辑器，未提供自由拖拽画布、公式编辑器或审批控制台。字段映射和可编辑范围还必须满足业务 API 的契约与权限；界面上的开关不授予后台写权限。

启动 `pnpm --filter @agile-team/example-minimal dev` 后访问 `http://localhost:8610/designer.html`。示例使用明确标识的本地数据与内存存储，不连接业务数据库。
