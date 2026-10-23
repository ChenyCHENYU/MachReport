export interface ReportPrintFont {
  /** Same family name used by the template. Sources are trusted application assets. */
  family: string;
  source: string;
  weight?: string;
  style?: "normal" | "italic" | "oblique";
}
export interface ReportPrintCalibration { offsetXmm?: number; offsetYmm?: number }
export interface ReportPrintOptions {
  /** Defaults to 15 seconds for the entire font/image preparation stage. */
  resourceTimeoutMs?: number;
  fonts?: readonly ReportPrintFont[];
  /** Physical translation only; no scaling or mutation of the report data/plan. */
  calibration?: ReportPrintCalibration;
}
export interface ReportPrintMessages {
  printPrepareTimeout?: string;
  printImageFailed?: string;
  printFontFailed?: string;
  printPrepareFailed?: string;
  printCalibration?: string;
  printOffsetX?: string;
  printOffsetY?: string;
  printCalibrationTest?: string;
  printCalibrationHint?: string;
}
export const DEFAULT_PRINT_MESSAGES: Required<ReportPrintMessages> = {
  printPrepareTimeout: "打印资源准备超时，请检查字体与图片后重试。",
  printImageFailed: "第 {index} 张图片未能加载，已停止打印，避免输出缺失内容。",
  printFontFailed: "打印字体 {family} 未能加载，请检查字体资源后重试。",
  printPrepareFailed: "打印准备失败，请检查打印配置或改用 PDF。",
  printCalibration: "打印校准", printOffsetX: "水平偏移（mm）", printOffsetY: "垂直偏移（mm）", printCalibrationTest: "打印校准页",
  printCalibrationHint: "正值向右／向下移动，负值向左／向上。使用同规格纸张及 100% 比例，先试打一张。系统对话框关闭不代表设备已完成。"
};

export function printCalibration(options?: ReportPrintOptions): { x: number; y: number } {
  const x = options?.calibration?.offsetXmm ?? 0, y = options?.calibration?.offsetYmm ?? 0;
  if (![x, y].every(value => Number.isFinite(value) && Math.abs(value) <= 20)) throw new RangeError("Print calibration must be within ±20 mm");
  return { x, y };
}
export function snapshotPrintOptions(options: ReportPrintOptions = {}): ReportPrintOptions {
  if (options.fonts && (!Array.isArray(options.fonts) || options.fonts.length > 8)) throw new RangeError("At most eight print font faces are allowed");
  return { ...options, ...(options.fonts ? { fonts: options.fonts.map(font => ({ ...font })) } : {}), ...(options.calibration ? { calibration: { ...options.calibration } } : {}) };
}
