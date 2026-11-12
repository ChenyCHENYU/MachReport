import type { ColumnFormat, ListColumn, ListComponent, ReportTemplateDocument } from "@agile-team/mach-report";
import { setColumnHeaderAlignment, synchronizeColumnWidths } from "./column-appearance";

export interface ColumnBatchPatch {
  widthMm?: number;
  align?: ListColumn["align"];
  headerAlign?: ListColumn["headerAlign"];
  format?: ColumnFormat | null;
  thousands?: boolean;
  bold?: boolean;
  italic?: boolean;
}

/** Undefined means leave each column's declaration untouched, including inherited styles. */
export function commonColumnValue<T>(columns: ListColumn[], read: (column: ListColumn) => T): { mixed: boolean; value: T | undefined } {
  const value = columns[0] && read(columns[0]);
  return { mixed: columns.some(column => read(column) !== value), value };
}

function patchFormat(column: ListColumn, patch: ColumnBatchPatch): void {
  if (patch.format === undefined) return;
  if (patch.format === null) { delete column.format; return; }
  column.format = { ...(column.format?.kind === patch.format.kind ? column.format : {}), ...patch.format } as ColumnFormat;
  if (column.format.kind === "number" && patch.thousands !== undefined) column.format.thousands = patch.thousands;
}

function patchColumn(list: ListComponent, index: number, patch: ColumnBatchPatch): void {
  const column = list.columns[index]!;
  if (patch.widthMm !== undefined) column.widthMm = patch.widthMm;
  if (patch.align !== undefined) column.align = patch.align;
  if (patch.headerAlign !== undefined) { column.headerAlign = patch.headerAlign; setColumnHeaderAlignment(list, index, patch.headerAlign); }
  patchFormat(column, patch);
  if (patch.bold !== undefined) column.style = { ...column.style, bold: patch.bold };
  if (patch.italic !== undefined) column.style = { ...column.style, italic: patch.italic };
}

/** Called only inside editor.transaction: validation and history are shared with single edits. */
export function applyColumnBatch(document: ReportTemplateDocument, pageIndex: number, componentIndex: number, indices: number[], patch: ColumnBatchPatch, invalid: string): void {
  const page = document.template.pages[pageIndex], list = page?.components[componentIndex];
  const selected = [...new Set(indices)];
  if (!page || list?.kind !== "list" || !selected.length || selected.some(index => !Number.isInteger(index) || !list.columns[index])) throw new Error(invalid);
  if (patch.widthMm !== undefined && (page.flow || !Number.isFinite(patch.widthMm) || patch.widthMm <= 0)) throw new Error(invalid);
  selected.forEach(index => patchColumn(list, index, patch));
  if (patch.widthMm !== undefined) synchronizeColumnWidths(page, list);
}
