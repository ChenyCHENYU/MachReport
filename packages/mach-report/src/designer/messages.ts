/** 可选设计器独立文案，不把其依赖和配置强加给预览消费者。 */
export const TEMPLATE_EDITOR_MESSAGES = {
  title: "报表模板属性编辑器", heading: "模板属性", unpublished: "未发布", dirty: "有未保存修改",
  reset: "恢复草稿", saving: "正在保存…", save: "保存草稿", name: "模板名称", description: "说明",
  area: "明细区域", page: "页", header: "表头", field: "业务字段", width: "列宽（mm）",
  semantic: "字段语义", identifier: "编号", dimension: "分类", measure: "数值", date: "日期", text: "文本",
  bodyAlign: "正文对齐", headerAlign: "表头对齐", auto: "按字段语义", left: "居左", center: "居中", right: "居右", justify: "两端对齐",
  editable: "允许编辑", json: "完整模板 JSON", applyJson: "校验并应用 JSON",
  note: "字段映射应与数据源契约一致。此编辑器维护模板属性；保存由接入方提供的版本服务处理。",
  invalid: "请先修正模板错误，再预览或保存。"
};
export type TemplateEditorMessages = typeof TEMPLATE_EDITOR_MESSAGES;
