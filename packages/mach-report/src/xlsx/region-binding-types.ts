import type { ReportTemplateDocument } from "../source/template-registry";
import type { ExcelImportResult } from "./import-types";
import type { ExcelBindingIssue, ExcelBindingSession, ExcelBindingDocumentResult } from "./binding-workflow";

/** A row prototype is replaced, never copied into a generated business report. */
export interface ExcelRegionBinding {
  id: string;
  /** One physical source row, with any contiguous subset of the sheet columns. */
  range: string;
  dataset: string;
  /** record accepts zero or one row; repeat expands vertically and shifts following bands. */
  mode: "record" | "repeat";
  fields: string[];
  rowKey: string;
  revisionField?: string;
  sourceTokenField?: string;
  /** Optional immediately preceding header, with the same physical columns. */
  headerRange?: string;
}

/** Version 2 describes several independent, vertically ordered data regions on one Sheet. */
export interface ExcelRegionBindingRecipe {
  version: "2.0";
  sheet: string;
  regions: ExcelRegionBinding[];
  /** Full-width source rows reserved on every page; excluded from flowing content. */
  footerRange?: string;
}
export interface ExcelRegionBindingValidation {
  ok: boolean;
  issues: ExcelBindingIssue[];
  mapped: number;
  total: number;
}
export interface ExcelRegionBindingSession {
  version: "2.0";
  source: ExcelImportResult;
  recipe: ExcelRegionBindingRecipe;
  identity: { id: string; name: string };
}
export interface ExcelRegionBindingDocumentResult {
  document: ReportTemplateDocument;
  recipe: ExcelRegionBindingRecipe;
  warnings: string[];
}
export type AnyExcelBindingSession = ExcelBindingSession | ExcelRegionBindingSession;
export type AnyExcelBindingDocumentResult = ExcelBindingDocumentResult | ExcelRegionBindingDocumentResult;
