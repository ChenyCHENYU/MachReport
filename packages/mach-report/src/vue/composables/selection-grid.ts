import type { PlanComponent, RenderPlan, ReportCellAddress } from "@agile-team/mach-report";

interface SelectionCoordinate { grid: string; row: number; column: number }
function firstLogicalRow(component: PlanComponent): number {
  // Public plans use header.rowIndex = -1, regardless of header depth. Selection
  // gives every header row a negative position so the last one cannot shadow body 0.
  return component.table!.role === "header" ? -Math.max(1, component.grid?.cells.length ?? 1) : component.table!.rowIndex;
}
export function selectionCoordinate(plan: RenderPlan, address: ReportCellAddress, origin = address): SelectionCoordinate {
  const component = plan.pages[address.pageIndex]?.components[address.componentIndex];
  const table = component?.table;
  const originTable = plan.pages[origin.pageIndex]?.components[origin.componentIndex]?.table;
  if (table && originTable && table.id === originTable.id) return {
    grid: table.id, row: firstLogicalRow(component) + address.rowIndex,
    column: originTable.columnKeys.indexOf(table.columnKeys[address.columnIndex] ?? "")
  };
  return { grid: `${address.pageIndex}:${address.componentIndex}`, row: address.rowIndex, column: address.columnIndex };
}

/** Resolve logical table rows across page fragments without treating them as database IDs. */
export function selectionAddressResolver(plan: RenderPlan, origin: ReportCellAddress): (row: number, column: number) => ReportCellAddress | null {
  const table = plan.pages[origin.pageIndex]?.components[origin.componentIndex]?.table;
  if (!table) return (rowIndex, columnIndex) => ({ ...origin, rowIndex, columnIndex });
  const rows = new Map<number, Array<{ address: ReportCellAddress; keys: string[] }>>();
  plan.pages.forEach((page, pageIndex) => page.components.forEach((component, componentIndex) => {
    if (component.table?.id !== table.id || !component.grid) return;
    component.grid.cells.forEach((_row, rowIndex) => {
      const logicalRow = firstLogicalRow(component) + rowIndex;
      rows.set(logicalRow, [...rows.get(logicalRow) ?? [], { address: { pageIndex, componentIndex, rowIndex, columnIndex: 0 }, keys: component.table!.columnKeys }]);
    });
  }));
  return (row, column) => {
    const field = table.columnKeys[column];
    if (field === undefined) return null;
    const match = rows.get(row)?.find((candidate) => candidate.keys.includes(field));
    return match ? { ...match.address, columnIndex: match.keys.indexOf(field) } : null;
  };
}
