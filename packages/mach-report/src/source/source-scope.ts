import type { PlanComponent } from "../schema/render-plan";

/** Scope nested cells as well as lists; hosts' templates and data remain untouched. */
export function scopePlanComponents(components: PlanComponent[], sourceScope: string, tableId: (id: string) => string): PlanComponent[] {
  return components.map((component) => {
    const table = component.table ? { ...component.table, id: tableId(component.table.id),
      ...(component.table.source ? { source: { ...component.table.source, sourceScope } } : {}) } : undefined;
    const cells = component.grid?.cells.map((row) => row.map((cell) => {
      if (!cell || !cell.source && !cell.children) return cell;
      return { ...cell, ...(cell.source ? { source: { ...cell.source, sourceScope } } : {}),
        ...(cell.children ? { children: scopePlanComponents(cell.children, sourceScope, tableId) } : {}) };
    }));
    return table || cells ? { ...component, ...(table ? { table } : {}),
      ...(cells ? { grid: { ...component.grid!, cells } } : {}) } : component;
  });
}
