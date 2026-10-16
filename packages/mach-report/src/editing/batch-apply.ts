import type { GridCell, PlanComponent, RenderPlan } from "../schema/render-plan";
import { resolveGridLayout } from "../render/grid-geometry";
import { createReportCellResolver, type ReportCellAddress, type ReportCellContext } from "./context";
import { formatReportCellEdit } from "./value";
import type { ReportCellEdit } from "./apply";

function locationKey(address: ReportCellAddress): string { return JSON.stringify([address.pageIndex, address.componentIndex, address.rowIndex, address.columnIndex]); }
function logicalKey(context: Pick<ReportCellContext, "table" | "address">): string {
  const table = context.table;
  return table?.columnKey !== undefined ? JSON.stringify([table.id, table.role, table.rowIndex, table.columnKey]) : locationKey(context.address);
}

/** Copy each affected page/component/row at most once. Mirrored table cells remain synchronized. */
export function applyIndexedEdits(plan: RenderPlan, edits: readonly ReportCellEdit[]): RenderPlan {
  if (!edits.length) return plan;
  const byIdentity = new Map(edits.map((edit) => [logicalKey(edit), edit]));
  const tables = new Set(edits.flatMap((edit) => edit.table ? [edit.table.id] : []));
  const components = new Set(edits.map((edit) => `${edit.address.pageIndex}:${edit.address.componentIndex}`));
  const resolve = createReportCellResolver(plan);
  function update(component: PlanComponent, pageIndex: number, componentIndex: number): PlanComponent {
    const grid = component.grid;
    if (!grid || (!components.has(`${pageIndex}:${componentIndex}`) && !tables.has(component.table?.id ?? ""))) return component;
    const rows = new Map<number, (GridCell | null)[]>();
    const sourceColumns = new Map<number, number>();
    for (const box of resolveGridLayout(grid, component.widthMm, component.heightMm).cells) {
      const sourceColumn = sourceColumns.get(box.ri) ?? 0;
      sourceColumns.set(box.ri, sourceColumn + 1);
      const context = resolve({ pageIndex, componentIndex, rowIndex: box.ri, columnIndex: box.ci });
      const edit = context && byIdentity.get(logicalKey(context));
      if (!edit || !context.editable) continue;
      const row = rows.get(box.ri) ?? [...grid.cells[box.ri]!];
      const text = formatReportCellEdit(context, edit.value);
      if (Object.is(context.value, edit.value) && text === context.cell.text) continue;
      row[sourceColumn] = { ...box.cell, value: edit.value, text, rawText: text };
      rows.set(box.ri, row);
    }
    if (!rows.size) return component;
    return { ...component, grid: { ...grid, cells: grid.cells.map((row, index) => rows.get(index) ?? row) } };
  }
  const pages = plan.pages.map((page, pageIndex) => {
    const next = page.components.map((component, componentIndex) => update(component, pageIndex, componentIndex));
    return next.every((component, index) => component === page.components[index]) ? page : { ...page, components: next };
  });
  return pages.every((page, index) => page === plan.pages[index]) ? plan : { ...plan, pages };
}
