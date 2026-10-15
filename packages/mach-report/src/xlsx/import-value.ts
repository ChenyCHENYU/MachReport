import type * as ExcelJS from "exceljs";
import type { GridCell } from "../schema/render-plan";
import { formatExcelNumber } from "../editing/number-format";
import { ImportWarnings } from "./import-types";

const DAY_MS = 86_400_000;
type RawValue = NonNullable<GridCell["value"]> | null;

function pad(value: number, count = 2): string { return String(value).padStart(count, "0"); }

function formatDate(value: Date, format: string, warn: () => void): string {
  const literals: string[] = [];
  const protectedFormat = format.replace(/"([^"]*)"|\\(.)/g, (_, quoted: string | undefined, escaped: string | undefined) => {
    literals.push(quoted ?? escaped ?? "");
    return `\uE000${literals.length - 1}\uE000`;
  }).replace(/\[\$[^\]]*\]/g, "");
  if (/\[|ddd|mmm|AM\/PM/i.test(protectedFormat)) {
    warn();
    return value.toISOString().replace("T", " ").replace(/\.000Z$/, "");
  }
  let previousTime = false;
  const rendered = protectedFormat.replace(/yyyy|yy|mm|m|dd|d|hh|h|ss|s/gi, (token: string, offset: number) => {
    const key = token.toLowerCase();
    if (key.startsWith("y")) return key.length === 2 ? pad(value.getUTCFullYear() % 100) : String(value.getUTCFullYear());
    if (key.startsWith("d")) return pad(value.getUTCDate(), key.length);
    if (key.startsWith("h")) { previousTime = true; return pad(value.getUTCHours(), key.length); }
    if (key.startsWith("s")) return pad(value.getUTCSeconds(), key.length);
    const minute = previousTime || /^\s*:\s*s/i.test(protectedFormat.slice(offset + token.length));
    return pad(minute ? value.getUTCMinutes() : value.getUTCMonth() + 1, key.length);
  });
  return rendered.replace(/\uE000(\d+)\uE000/g, (_, index: string) => literals[Number(index)] ?? "");
}

function scalarValue(value: ExcelJS.CellValue | undefined, format: string, warn: () => void): { text: string; value: RawValue } {
  if (value == null) return { text: "", value: null };
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) { warn(); return { text: "", value: null }; }
    // RenderPlan uses the 1900 epoch so sheets from different workbooks can export together.
    return { text: formatDate(value, format || "yyyy-mm-dd", warn), value: value.getTime() / DAY_MS + 25_569 };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) { warn(); return { text: String(value), value: null }; }
    return { text: formatExcelNumber(value, format, warn), value };
  }
  if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE", value };
  if (typeof value === "string") return { text: value, value };
  if ("error" in value) return { text: value.error, value: value.error };
  if ("richText" in value) {
    const text = value.richText.map((segment) => segment.text).join("");
    return { text, value: text };
  }
  if ("text" in value) return { text: String(value.text), value: String(value.text) };
  warn(); return { text: "", value: null };
}

function valueType(value: RawValue, format: string): GridCell["valueType"] {
  const tokens = (format ?? "").replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "");
  if (typeof value === "number" || (value === null && /[0#?]/.test(tokens))) return "number";
  return typeof value === "boolean" ? "boolean" : "text";
}

function applyFormulaMetadata(imported: GridCell, cell: ExcelJS.Cell, result: ExcelJS.CellValue | undefined, sheet: string, warnings: ImportWarnings): void {
  // Shared formulas are translated by ExcelJS without evaluating or resolving external links.
  let expression: string | undefined;
  try { expression = cell.formula; } catch { warnings.add(`${sheet}: 部分共享公式无法展开，仅保留缓存结果`); }
  Object.assign(imported, { editable: false, ...(expression ? { formula: expression } : {}) });
  warnings.add(`${sheet}: 公式使用 Excel 已保存的计算结果并保持只读；修改其他单元格不会自动重算公式`);
  if (result === undefined || result === null) warnings.add(`${sheet}: 存在没有缓存结果的公式，显示为空；请先在 Excel 中计算并保存`);
}

/** Formulas are never evaluated; their cached scalar result is the only displayed value. */
export function importCellValue(cell: ExcelJS.Cell, date1904: boolean, sheet: string, warnings: ImportWarnings): GridCell {
  const format = cell.numFmt;
  const warn = () => warnings.add(`${sheet}: 存在无法完整还原的自定义数字或日期格式，已保留原值和 numberFormat`);
  const raw = cell.value;
  const formula = raw && typeof raw === "object" && ("formula" in raw || "sharedFormula" in raw);
  // ExcelJS 4.4 cell.value omits falsy formula results; its public result getter preserves 0/false.
  const result = formula ? cell.result : raw;
  const value = scalarValue(result, format, warn);
  const imported: GridCell = { ...value, editable: true, ...(format ? { numberFormat: format } : {}) };
  imported.valueType = valueType(value.value, format);
  if (result instanceof Date) {
    Object.assign(imported, { editable: false });
    warnings.add(`${sheet}: 日期单元格保留 Excel 日期序列与格式，目前在预览中保持只读`);
    if (date1904) warnings.add(`${sheet}: 1904 日期系统已统一转换为 1900 日期系统，保留相同日历日期`);
  }
  if (formula) applyFormulaMetadata(imported, cell, result, sheet, warnings);
  if (raw && typeof raw === "object" && "richText" in raw) warnings.add(`${sheet}: 单元格内混合字体已合并为纯文本，保留单元格级样式`);
  if (typeof imported.text === "string" && /\{\{[^}]+\}\}/.test(imported.text)) warnings.add(`${sheet}: {{字段}} 占位符按原文导入；动态业务数据需显式绑定，不会自动推断接口字段`);
  return imported;
}
