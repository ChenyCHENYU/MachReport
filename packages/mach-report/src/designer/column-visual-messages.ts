export const COLUMN_VISUAL_MESSAGES = {
  title: "数据可视化", enabled: "启用列可视化", kind: "呈现方式", colorScale: "色阶", dataBar: "数据条", measure: "度量字段", ownField: "当前列", numeric: "度量类型", number: "真实数字", decimal: "小数文本（显式转换）", autoDomain: "自动统计范围", minimum: "最小值", maximum: "最大值", lowColor: "低值颜色", highColor: "高值颜色", color: "正值颜色", negativeColor: "负值颜色", invalid: "请检查范围与颜色；最小值不能大于最大值。", hint: "保留原始数据与编辑能力。空值不绘制，零值按真实零处理；统计范围来自当前明细。", snapshot: "Excel 数据条为静态视觉快照，修改 Excel 后不会重算。",
};
export type ColumnVisualMessages = typeof COLUMN_VISUAL_MESSAGES;
