import { ReportCellEditError, reportCellEditKey, type RenderPlan, type ReportCellAddress, type ReportCellEdit, type ReportCellValue } from "@agile-team/mach-report";
import { createReportCellIndex } from "../editing/context";

export type ConflictChoice = "local" | "server";
export interface ConflictReviewRow {
  key: string;
  edit: ReportCellEdit;
  availability: "available" | "missing" | "ambiguous" | "readonly";
  latestValue?: ReportCellValue;
  latestText?: string;
  address?: ReportCellAddress;
  choice: ConflictChoice | null;
}

/** One operation-local scan. Business identity is typed and scoped, never inferred from a row index. */
export function createConflictReview(plan: RenderPlan, edits: readonly ReportCellEdit[]): ConflictReviewRow[] {
  if (edits.length > 10_000) throw new ReportCellEditError("limit");
  const rows = new Map<string, ConflictReviewRow>(edits.map(edit => [reportCellEditKey(edit), {
    key: reportCellEditKey(edit), edit, availability: "missing", choice: null
  }]));
  const index = createReportCellIndex(plan);
  const versions = new Map<string, string>();
  let visited = 0;
  plan.pages.forEach((page, pageIndex) => page.components.forEach((component, componentIndex) => {
    if (!component.grid) return;
    for (const cells of component.grid.cells) { visited += cells.length; if (visited > 1_000_000) throw new ReportCellEditError("limit"); }
    for (const cell of index.entries(pageIndex, componentIndex)) {
      if (!cell.source) continue;
      const row = rows.get(reportCellEditKey(cell));
      if (!row) continue;
      const version = JSON.stringify([cell.source.revision, cell.source.sourceToken]);
      if (row.address) {
        if (versions.get(row.key) !== version || !Object.is(row.latestValue, cell.value) || row.availability === "readonly" && cell.editable || row.availability === "available" && !cell.editable) row.availability = "ambiguous";
        continue;
      }
      versions.set(row.key, version);
      row.address = { ...cell.address }; row.latestValue = cell.value; row.latestText = cell.cell.text ?? "";
      row.availability = cell.editable ? "available" : "readonly";
    }
  }));
  for (const row of rows.values()) {
    if (row.availability !== "available") continue;
    if (Object.is(row.latestValue, row.edit.value)) row.choice = "server";
    else if (Object.is(row.latestValue, row.edit.previousValue)) row.choice = "local";
  }
  return [...rows.values()];
}
