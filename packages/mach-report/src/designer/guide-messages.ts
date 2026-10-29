export const DESIGNER_GUIDE_MESSAGES = {
  title: "操作指引", prompt: "这次想调整什么？", close: "关闭操作指引", fields: "改字段、对齐和颜色", fieldsHint: "选中一列，再修改属性；支持数据条与色阶", components: "加图表、二维码或条码", componentsHint: "进入画布，添加组件并绑定真实字段", layout: "改纸张、页数和份数", layoutHint: "设置毫米尺寸、标准纸型及逐记录输出", excel: "从 Excel 还原模板", excelHint: "导入工作簿，再明确字段和区域绑定", rules: "配计算和条件样式", rulesHint: "先配置，再应用到模板；不会修改接口实绩", review: "检查并定位问题", reviewHint: "校验字段依赖、样例结果与输出限制", result: "预览确认效果后保存模板；高级 JSON 保留给需要时使用。",
} as const;
export type DesignerGuideMessages = { [K in keyof typeof DESIGNER_GUIDE_MESSAGES]: string };
