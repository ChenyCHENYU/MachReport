export const LABEL_STUDIO_MESSAGES = {
  applyFirst: "请先应用当前配置或修正模板问题，再切换打印预览。", saveFailed: "模板尚未保存，请检查提示后重试。",
  title: "标识打印", preview: "打印预览", design: "设计标签", records: "预览记录", all: "全部记录", record: "记录序号", single: "单条预览", faces: "个版面", labels: "张标签", session: "当前会话模板", flow: "选择记录 → 设计标签 → 预览并打印", guide: "使用指引", help: "在画布点选文字或码图，再设置绑定字段；在“模板”中调整纸张与份数。", size: "纸张与份数", bindings: "字段与码图", count: "条记录", invalidCopies: "份数待校验", sheet: "A4 标签拼版", sheetHint: "2 列 × 4 行，保持原尺寸", printHint: "先试打一张，使用同规格纸张与 100% 比例核对尺寸和扫码。", empty: "暂无可打印记录", save: "保存标签模板",
} as const;
export type LabelStudioMessages = { [K in keyof typeof LABEL_STUDIO_MESSAGES]: string };
