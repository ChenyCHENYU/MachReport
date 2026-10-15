import type { ReportCellContext, ReportCellValue } from "./context";
import { formatExcelNumber, isExcelPercentageFormat } from "./number-format";

export type ReportCellEditErrorCode = "missing" | "readonly" | "number" | "boolean" | "conflict";

export class ReportCellEditError extends Error {
  constructor(public readonly code: ReportCellEditErrorCode) {
    super(`Invalid report cell edit: ${code}`);
    this.name = "ReportCellEditError";
  }
}

function numericString(input: string, percent: boolean): number {
  let text = input.trim();
  const percentInput = percent && text.endsWith("%");
  if (percentInput) text = text.slice(0, -1).trim();
  if (/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?(?:[eE][+-]?\d+)?$/.test(text)) text = text.replace(/,/g, "");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) throw new ReportCellEditError("number");
  return Number(text) / (percentInput ? 100 : 1);
}

function numberInput(input: ReportCellValue, context: ReportCellContext): ReportCellValue {
  if (input === null || (typeof input === "string" && input.trim() === "")) return null;
  if (typeof input !== "string" && typeof input !== "number") throw new ReportCellEditError("number");
  const value = typeof input === "number" ? input : numericString(input, isExcelPercentageFormat(context.cell.numberFormat));
  if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new ReportCellEditError("number");
  return value;
}

function booleanInput(input: ReportCellValue): ReportCellValue {
  if (input === null || (typeof input === "string" && input.trim() === "")) return null;
  if (typeof input === "boolean") return input;
  const text = String(input).trim().toLowerCase();
  if (["true", "yes", "是", "1"].includes(text)) return true;
  if (["false", "no", "否", "0"].includes(text)) return false;
  throw new ReportCellEditError("boolean");
}

/** 严格解析编辑输入；文本列不隐式推断数值，清空数值/布尔列得到 null。 */
export function parseReportCellInput(context: ReportCellContext, input: ReportCellValue): ReportCellValue {
  if (context.valueType === "number") return numberInput(input, context);
  if (context.valueType === "boolean") return booleanInput(input);
  return input === null ? null : String(input);
}

function displayBoolean(value: boolean, context: ReportCellContext): string {
  const previous = context.cell.text;
  const pairs = [["是", "否"], ["TRUE", "FALSE"], ["True", "False"], ["true", "false"], ["1", "0"]];
  const pair = pairs.find((candidate) => candidate.includes(previous ?? ""));
  return pair ? pair[value ? 0 : 1]! : String(value);
}

/** 同步 text/raw value，所有输出后端读取同一份更新后的 RenderPlan。 */
export function formatReportCellEdit(context: ReportCellContext, value: ReportCellValue): string {
  if (value === null) return "";
  if (typeof value === "boolean") return displayBoolean(value, context);
  return typeof value === "number" ? formatExcelNumber(value, context.cell.numberFormat) : String(value);
}
