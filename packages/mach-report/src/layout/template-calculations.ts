import type { ListComponent, ReportTemplate } from "./paginate";
function listRequiresRecalculation(list: ListComponent): boolean {
  return !!(list.computed?.length || list.groups?.length || list.groupBy || list.grandTotal || list.rowVisibleWhen || list.matrix || list.tree || list.detail || list.columns.some((column) => column.rules?.length || column.visibleWhen));
}
/** Serializable capability requirement; it deliberately does not claim a local session survived transport. */
export function templateRequiresRecalculation(template: ReportTemplate): boolean {
  return template.pages.some((page) => page.components.some((component) => component.kind === "list" && listRequiresRecalculation(component)));
}
