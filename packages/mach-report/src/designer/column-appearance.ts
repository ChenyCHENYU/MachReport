import { resolveGridLayout, type ListColumn, type ListComponent, type ReportTemplate } from "@agile-team/mach-report";

/** Keep designer controls consistent with the layout engine's omitted-value policy. */
export function bodyAlignment(column: ListColumn, list: ListComponent): NonNullable<ListColumn["align"]> {
  return column.align ?? column.style?.align ?? list.align ?? "auto";
}

export function synchronizeColumnWidths(page: ReportTemplate["pages"][number], list: ListComponent): void {
  const widths = list.columns.map(column => column.widthMm);
  if (list.headerGrid) list.headerGrid.colWidthsMm = widths;
  if (page.layout !== "wide" || !widths.every(width => Number.isFinite(width) && width > 0)) return;
  list.widthMm = widths.reduce((sum, width) => sum + width, 0);
  page.widthMm = Math.max(...page.components.map(component => component.leftMm + component.widthMm)) + (page.marginRightMm ?? 0);
}

export function setColumnHeaderAlignment(list: ListComponent, index: number, align: NonNullable<ListColumn["headerAlign"]>): void {
  const column = list.columns[index];
  if (column?.headerStyle?.align !== undefined) column.headerStyle = { ...column.headerStyle, align };
  if (!list.headerGrid) return;
  const box = resolveGridLayout(list.headerGrid, list.widthMm, 100).cells
    .filter(({ ci, cell }) => ci <= index && ci + (cell.colSpan ?? 1) > index).slice(-1)[0];
  if (!box) return;
  box.cell.style = { ...box.cell.style, align };
  list.columns.slice(box.ci, box.ci + (box.cell.colSpan ?? 1)).forEach(item => {
    item.headerAlign = align;
    if (item.headerStyle?.align !== undefined) item.headerStyle = { ...item.headerStyle, align };
  });
}
