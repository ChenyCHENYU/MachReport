import type { ExcelImportResult } from "./import-types";
import { parseImportRange } from "./import-range";
import type { ExcelBindingIssue, ExcelBindingRecipe } from "./binding-workflow";

/** Inspect current source values; public validation must never reuse a stale mutable-workbook result. */
export function excelBindingMergeIssues(
  imported: ExcelImportResult,
  recipe: ExcelBindingRecipe,
): ExcelBindingIssue[] {
  return scanMergeIssues(imported, recipe);
}
function scanMergeIssues(
  imported: ExcelImportResult,
  recipe: ExcelBindingRecipe,
): ExcelBindingIssue[] {
  const sheet = imported.sheets.find((item) => item.name === recipe.sheet);
  if (!sheet) return [];
  const header = parseImportRange(recipe.regions.header),
    detail = parseImportRange(recipe.regions.detail);
  const boundaries = [header.top, header.bottom + 1, detail.bottom + 1];
  const issues: ExcelBindingIssue[] = [];
  const recorded = new Set<string>();
  for (const page of imported.template.pages.slice(
    sheet.pageStart,
    sheet.pageStart + sheet.pageCount,
  )) {
    for (const component of page.components) {
      if (
        component.kind === "list" ||
        !component.grid ||
        component.meta?.xlsxSheet !== recipe.sheet
      )
        continue;
      const range = parseImportRange(String(component.meta.xlsxRange));
      component.grid.cells.forEach((cells, offset) => {
        const row = range.top + offset;
        for (const cell of cells) {
          const crossing = boundaries.some(
            (boundary) =>
              row < boundary && row + (cell?.rowSpan ?? 1) > boundary,
          );
          const mergedDetail =
            row === detail.top &&
            ((cell?.rowSpan ?? 1) > 1 || (cell?.colSpan ?? 1) > 1);
          if (!crossing && !mergedDetail) continue;
          const path = crossing
            ? "$.recipe.regions"
            : "$.recipe.regions.detail";
          if (recorded.has(path)) continue;
          recorded.add(path);
          issues.push({
            path,
            code: "region",
            message: crossing
              ? `第 ${row} 行合并区域跨越绑定边界，请选择完整合并区域`
              : "动态明细原型行不能包含合并格",
          });
        }
      });
    }
  }
  return issues;
}
