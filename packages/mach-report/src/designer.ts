/** 可选 Vue 模板属性编辑器；不会进入主引擎或常规 Vue 预览入口。 */
import { defineAsyncComponent } from "vue";
export { default as ReportTemplateEditor } from "./designer/ReportTemplateEditor.vue";
export type { TemplateEditorOptions, TemplateEditorSaveContext, TemplateEditorController } from "./designer/useTemplateEditor";
export type { TemplateEditorBeforeDiscard, TemplateEditorBeforeDiscardContext } from "./designer/useTemplateDiscard";
export { TEMPLATE_EDITOR_MESSAGES } from "./designer/messages";
export type { TemplateEditorMessages } from "./designer/messages";
export const TemplateReviewPanel = defineAsyncComponent(() => import("./designer/TemplateReviewPanel.vue"));
export { TEMPLATE_REVIEW_MESSAGES } from "./designer/review-messages";
export type { TemplateReviewMessages } from "./designer/review-messages";
export const ExcelBindingWizard = defineAsyncComponent(() => import("./designer/ExcelBindingWizard.vue"));
export type { ExcelBindingWizardOptions, ExcelBindingWizardApply } from "./designer/useExcelBindingWizard";
export { EXCEL_BINDING_MESSAGES } from "./designer/excel-binding-messages";
export type { ExcelBindingMessages } from "./designer/excel-binding-messages";
export const RuleEditor = defineAsyncComponent(() => import("./designer/RuleEditor.vue"));
export { DEFAULT_RULE_EDITOR_MESSAGES as RULE_EDITOR_MESSAGES } from "./designer/rule-messages";
export type { RuleEditorMessages } from "./designer/rule-messages";
export type { RuleEditorOptions } from "./designer/useRuleEditor";
