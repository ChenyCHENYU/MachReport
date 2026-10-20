import { defineReportTemplate, parseReportTemplate } from "../source/template-registry";
import type { ExcelBindingDataset } from "./binding-workflow";
import { checkedMetadata } from "./binding-json";
import { parseImportRange, rangeName } from "./import-range";
import type { ExcelImportResult } from "./import-types";
import { compileExcelRegionBindings } from "./region-binding-compile";
import { cloneRegionValue } from "./region-binding-source";
import { validateExcelRegionBindings } from "./region-binding-validation";
import type { ExcelRegionBindingDocumentResult, ExcelRegionBindingRecipe, ExcelRegionBindingSession } from "./region-binding-types";

export * from "./region-binding-types";
export { validateExcelRegionBindings, validateExcelRegionGeometry, validateExcelRegionFields } from "./region-binding-validation";

export function createExcelRegionBindingDocument(imported: ExcelImportResult, recipe: ExcelRegionBindingRecipe, datasets: readonly ExcelBindingDataset[], identity: { id: string; name: string }): ExcelRegionBindingDocumentResult {
  const validation = validateExcelRegionBindings(imported, recipe, datasets);
  if (!validation.ok) throw new Error(validation.issues.map(issue => `${issue.path}: ${issue.message}`).join("\n"));
  return {
    document: defineReportTemplate({ ...identity, template: compileExcelRegionBindings(imported, recipe, datasets, identity.id) }),
    recipe: cloneRegionValue(recipe), warnings: [...imported.warnings],
  };
}
function checkRecipe(recipe: ExcelRegionBindingRecipe): void {
  if (!recipe || recipe.version !== "2.0" || typeof recipe.sheet !== "string" || !Array.isArray(recipe.regions) || !recipe.regions.length || recipe.regions.length > 128) throw new Error("多区域绑定会话配置或版本无效");
  for (const region of recipe.regions) {
    if (!region || typeof region.id !== "string" || typeof region.dataset !== "string" || typeof region.rowKey !== "string" || !["record", "repeat"].includes(region.mode) || !Array.isArray(region.fields) || region.fields.length > 2048 || region.fields.some(field => typeof field !== "string")) throw new Error("多区域绑定会话的区域结构无效");
    if (region.range) parseImportRange(region.range);
    if (region.headerRange) parseImportRange(region.headerRange);
  }
  if (recipe.footerRange) parseImportRange(recipe.footerRange);
}
/** Draft sessions preserve exact incomplete mappings; applying still runs geometry and contract checks. */
export function createExcelRegionBindingSession(source: ExcelImportResult, recipe: ExcelRegionBindingRecipe, identity: { id: string; name: string }): ExcelRegionBindingSession {
  checkedMetadata({ sheets: source.sheets, warnings: source.warnings, recipe, identity });
  checkRecipe(recipe);
  if (!Array.isArray(source.sheets) || !source.sheets.length || !Array.isArray(source.warnings) || source.warnings.some(item => typeof item !== "string") || !source.sheets.some(sheet => sheet.name === recipe.sheet)) throw new Error("多区域绑定会话的来源无效");
  for (const sheet of source.sheets) {
    parseImportRange(sheet.range);
    if (![sheet.index, sheet.rowCount, sheet.columnCount, sheet.pageCount].every(value => Number.isInteger(value) && value > 0) || !Number.isInteger(sheet.pageStart) || sheet.pageStart < 0 || sheet.pageStart + sheet.pageCount > source.template.pages.length) throw new Error("多区域绑定会话的工作表几何无效");
  }
  parseReportTemplate({ schemaVersion: "1.0", ...identity, template: source.template });
  return cloneRegionValue({ version: "2.0", source, recipe, identity });
}
export function parseExcelRegionBindingSession(input: unknown): ExcelRegionBindingSession {
  if (typeof input === "string" && input.length > 10_000_000) throw new Error("绑定会话超过 1000 万字符上限");
  const value = typeof input === "string" ? JSON.parse(input) as ExcelRegionBindingSession : input as ExcelRegionBindingSession;
  if (!value || value.version !== "2.0" || !value.source || !value.recipe || !value.identity) throw new Error("多区域绑定会话结构或版本无效");
  return createExcelRegionBindingSession(value.source, value.recipe, value.identity);
}
/** Convert graphical two-dimensional selection into exact, source-bounded coordinates. */
export function excelBindingCellRange(imported: ExcelImportResult, sheetName: string, from: { row: number; column: number }, to = from): string {
  const sheet = imported.sheets.find(item => item.name === sheetName);
  if (!sheet) throw new Error("工作表不存在");
  const source = parseImportRange(sheet.range);
  if (![from.row, from.column, to.row, to.column].every(Number.isInteger)) throw new Error("单元格坐标应为整数");
  const range = { top: Math.min(from.row, to.row), bottom: Math.max(from.row, to.row), left: Math.min(from.column, to.column), right: Math.max(from.column, to.column) };
  if (range.top < source.top || range.bottom > source.bottom || range.left < source.left || range.right > source.right) throw new Error("选区超出来源工作表");
  return rangeName(range);
}
