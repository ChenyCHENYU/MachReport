/**
 * 全引擎共享默认值（唯一真相源）。
 *
 * 修改这里的任何常量前请注意消费方：
 * - LINE_HEIGHT：分页行高估算 / Canvas / PDF 三处换算必须一致
 * - DEFAULT_FONT_PT / DEFAULT_BORDER_PT：三后端默认字号与线宽
 * - SCHEMA_VERSION_*：RenderPlan 版本标识（adapter 产出侧使用）
 *
 * 历史：这些值曾散落在 paginate/canvas/pdf/dom 四个文件中各写一份，
 * 是三后端漂移的温床，收敛于此。
 */

/** 默认行高倍数（基线距 = 字号 × 该系数） */
export const LINE_HEIGHT = 1.35;

/** 默认字号（pt） */
export const DEFAULT_FONT_PT = 10.5;

/** 默认边框线宽（pt） */
export const DEFAULT_BORDER_PT = 0.75;

/** 默认描边色 */
export const DEFAULT_STROKE_COLOR = "#333333";

/** 默认文本色 */
export const DEFAULT_TEXT_COLOR = "#000000";

/** RenderPlan 正式 schema 版本（core 分页引擎产出） */
export const SCHEMA_VERSION_MACH = "1.0.0-mach";
