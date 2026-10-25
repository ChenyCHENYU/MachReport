import type { RenderPlan } from "../schema/render-plan";
import { resolveGridLayout } from "../render/grid-geometry";
import { assertDataFields, assertDataSource, dataLimit, dataRowKey, ReportDataError, type ReportDataLimits, type ReportDataRecord, type ReportDataSnapshot } from "../processing/data-records";
import { createReportCellResolver, type ReportCellContext, type ReportCellValue } from "./context";
import { reportCellEditKey } from "./batch";

export interface ReportPlanDataOptions extends ReportDataLimits {
  sourceScope?: string;
  datasetId: string;
  fields: readonly string[];
}
export interface IndexedReportDataCell { context: ReportCellContext; ambiguous: boolean }
/** Bounded operation-local index, shared by prefill review, comparison and source navigation. */
export function indexReportDataCells(plan: RenderPlan, options: ReportPlanDataOptions): Map<string, IndexedReportDataCell> {
  assertDataSource(options); assertDataFields(options.fields, dataLimit(options.maxFields, 256, 1024));
  const max = dataLimit(options.maxCells, 1_000_000, 2_000_000), fields = new Set(options.fields), result = new Map<string, IndexedReportDataCell>();
  const resolve = createReportCellResolver(plan);
  let visited = 0;
  for (const [pageIndex, page] of plan.pages.entries()) for (const [componentIndex, component] of page.components.entries()) {
    if (!component.grid) continue;
    // Reject an oversized grid before asking the geometry engine to allocate its boxes.
    for (const row of component.grid.cells) { visited += row.length; if (visited > max) throw new ReportDataError("limit", "Report cell scan exceeds its budget"); }
    const boxes = resolveGridLayout(component.grid, component.widthMm, component.heightMm).cells;
    for (const box of boxes) {
      const context = resolve({ pageIndex, componentIndex, rowIndex: box.ri, columnIndex: box.ci }), source = context?.source;
      if (!context || !source || source.datasetId !== options.datasetId || source.sourceScope !== options.sourceScope || !fields.has(source.field)) continue;
      dataRowKey(source.rowKey);
      const key = reportCellEditKey(context), previous = result.get(key);
      if (!previous) result.set(key, { context, ambiguous: false });
      else if (!Object.is(previous.context.value, context.value) || previous.context.source?.revision !== source.revision || previous.context.source?.sourceToken !== source.sourceToken || previous.context.editable !== context.editable) previous.ambiguous = true;
    }
  }
  return result;
}
/** Extracts explicit fields from the same rendered query; never makes a second business request. */
export function reportDataSnapshotFromPlan(plan: RenderPlan, options: ReportPlanDataOptions): ReportDataSnapshot {
  const cells = indexReportDataCells(plan, options), rows = new Map<string, { rowKey: string | number; values: Record<string, ReportCellValue> }>();
  const maxRows = dataLimit(options.maxRows, 50_000, 100_000);
  for (const { context, ambiguous } of cells.values()) {
    if (ambiguous) throw new ReportDataError("conflict", "Repeated report cells disagree for the same business field");
    const source = context.source!, key = dataRowKey(source.rowKey);
    let row = rows.get(key);
    if (!row) { if (rows.size >= maxRows) throw new ReportDataError("limit", "Report row extraction exceeds its budget"); row = { rowKey: source.rowKey, values: Object.create(null) as Record<string, ReportCellValue> }; rows.set(key, row); }
    row.values[source.field] = context.value;
  }
  return { sourceScope: options.sourceScope, datasetId: options.datasetId, rows: [...rows.values()] satisfies ReportDataRecord[] };
}
