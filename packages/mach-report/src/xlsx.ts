/**
 * Excel 导入/导出子路径入口（@agile-team/mach-report/xlsx）：
 * xlsx 单元格模板 ↔ RenderPlan（exceljs 内联，零运行时依赖声明不变）。
 */
export * from "./xlsx/render-xlsx";
export { importExcelTemplate, inspectExcelWorkbook, type ExcelWorkbookSheet, type ExcelWorkbookInspection, type ExcelImportOptions, type ExcelImportLimits, type ExcelImportedSheet, type ExcelImportResult } from "./xlsx/import-template";
export * from "./xlsx/workbook-session";
export * from "./xlsx/bind-template";
export * from "./xlsx/binding-workflow";
export * from "./xlsx/binding-preview";
