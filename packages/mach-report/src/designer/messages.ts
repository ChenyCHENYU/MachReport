/** 可选设计器独立文案，不把其依赖和配置强加给预览消费者。 */
const BASE_TEMPLATE_EDITOR_MESSAGES = {
  title: "报表模板属性编辑器", heading: "模板属性", unpublished: "未发布", dirty: "有未保存修改",
  reset: "恢复草稿", saving: "正在保存…", save: "保存草稿", name: "模板名称", description: "说明",
  area: "明细区域", page: "页", header: "表头", field: "业务字段", width: "列宽（mm）",
  semantic: "字段语义", identifier: "编号", dimension: "分类", measure: "数值", date: "日期", text: "文本",
  bodyAlign: "正文对齐", headerAlign: "表头对齐", auto: "按字段语义", left: "居左", center: "居中", right: "居右", justify: "两端对齐",
  editable: "允许编辑", json: "完整模板 JSON", applyJson: "校验并应用 JSON",
  note: "字段映射应与数据源契约一致。此编辑器维护模板属性；保存由接入方提供的版本服务处理。",
  invalid: "请先修正模板错误，再预览或保存。"
};
const PRODUCT_TEMPLATE_EDITOR_MESSAGES = {
  undo: "撤销", redo: "重做", columnsSearch: "搜索列名或字段", columnsSelected: "已选列", selectVisible: "选择当前结果", clearSelection: "清除选择",
  noColumns: "没有匹配的列", batchBody: "批量正文对齐", batchHeader: "批量表头对齐", chooseAlignment: "选择对齐方式",
  discardTitle: "保留当前修改？", discardDescription: "当前包含未保存的属性或尚未应用的 JSON，继续将丢弃这些修改。",
  keepEditing: "继续编辑", discard: "丢弃修改并继续", jsonPending: "JSON 尚未应用。请先校验并应用，或撤销 JSON 修改后继续属性编辑与保存。",
  fieldsSection: "字段", templateSection: "模板", advancedSection: "高级", sectionsLabel: "模板设置分区",
  columnDirectory: "字段目录", columnProperties: "字段属性", selectColumn: "选择字段", clearSearch: "清除搜索",
  fieldsCount: "个字段", templateDetails: "模板信息", advancedTitle: "完整配置", advancedDescription: "用于批量迁移或配置复杂模板。应用前会校验；未应用的内容会受到草稿保护。",
  templateIdentity: "模板标识", templateRevision: "当前修订", readonly: "只读", ready: "可编辑", previewTitle: "实时预览"
};
export const TEMPLATE_EDITOR_MESSAGES = { ...BASE_TEMPLATE_EDITOR_MESSAGES, ...PRODUCT_TEMPLATE_EDITOR_MESSAGES };
/** Newly introduced labels are optional for existing complete message dictionaries. */
export type TemplateEditorMessages = typeof BASE_TEMPLATE_EDITOR_MESSAGES & Partial<typeof PRODUCT_TEMPLATE_EDITOR_MESSAGES>;
