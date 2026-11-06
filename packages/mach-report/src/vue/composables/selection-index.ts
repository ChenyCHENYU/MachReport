import { type RenderPlan, type ReportCellAddress, type ReportCellContext, type ReportCellEdit } from "@agile-team/mach-report";
import { type GridLayout } from "../../render/grid-geometry";
import { createReportCellIndex } from "../../editing/context";
import { createEditAddressResolver } from "./edit-recalculation";
import type { ReportFieldTarget } from "./useCellSelection";

interface AddressPosition { linear: number; row: number; column: number }
interface GridAddresses { all: ReportCellAddress[]; rows: Map<number, ReportCellAddress[]>; columns: Map<number, ReportCellAddress[]>; positions: Map<string, AddressPosition> }
function key(address: ReportCellAddress): string { return `${address.rowIndex}:${address.columnIndex}`; }
function containsField(context: ReportCellContext, field: string): boolean {
  if ((context.source?.field ?? context.table?.columnKey) === field) return true;
  if (context.table?.role !== "header") return false;
  return context.component.table?.columnKeys.slice(context.address.columnIndex, context.address.columnIndex + (context.cell.colSpan ?? 1)).includes(field) ?? false;
}
function matchesField(context: ReportCellContext, target: ReportFieldTarget): boolean {
  if (!containsField(context, target.field)) return false;
  if (target.tableId !== undefined && context.table?.id !== target.tableId) return false;
  if (target.datasetId !== undefined && (context.source?.datasetId ?? context.component.table?.source?.datasetId) !== target.datasetId) return false;
  return target.rowKey === undefined || context.source?.rowKey === target.rowKey;
}
function append(map: Map<number, ReportCellAddress[]>, axis: number, address: ReportCellAddress): number {
  const list = map.get(axis) ?? []; const offset = list.length; list.push(address); map.set(axis, list); return offset;
}
function gridAddresses(layout: GridLayout, origin: ReportCellAddress): GridAddresses {
  const result: GridAddresses = { all: [], rows: new Map(), columns: new Map(), positions: new Map() };
  for (const box of layout.cells) {
    const address = { pageIndex: origin.pageIndex, componentIndex: origin.componentIndex, rowIndex: box.ri, columnIndex: box.ci };
    const position = { linear: result.all.length, row: append(result.rows, box.ri, address), column: append(result.columns, box.ci, address) };
    result.all.push(address); result.positions.set(key(address), position);
  }
  return result;
}

/** Owned by one preview publication. New plans release old geometry, field and source indexes. */
export function createSelectionIndex(plan: RenderPlan) {
  const grids = new Map<string, GridAddresses>();
  const fields = new Map<string, ReportCellAddress | null>();
  const cells = createReportCellIndex(plan), cellAt = cells.resolve;
  let edits: ReturnType<typeof createEditAddressResolver> | undefined;
  function cacheField(key: string, address: ReportCellAddress | null): ReportCellAddress | null {
    if (fields.size >= 512) fields.delete(fields.keys().next().value!);
    fields.set(key, address); return address;
  }
  function grid(address: ReportCellAddress): GridAddresses | undefined {
    const component = plan.pages[address.pageIndex]?.components[address.componentIndex];
    if (!component?.grid) return;
    const identity = `${address.pageIndex}:${address.componentIndex}`;
    let index = grids.get(identity);
    if (!index) { index = gridAddresses(cells.layout(component)!, address); grids.set(identity, index); }
    return index;
  }
  function adjacent(address: ReportCellAddress, direction: string, backwards: boolean): ReportCellAddress | undefined {
    const index = grid(address), position = index?.positions.get(key(address));
    if (!index || !position) return;
    const step = direction === "ArrowUp" || direction === "ArrowLeft" || backwards ? -1 : 1;
    if (direction === "Tab") return index.all[position.linear + step];
    const vertical = direction === "ArrowUp" || direction === "ArrowDown" || direction === "Enter";
    return vertical ? index.columns.get(address.columnIndex)?.[position.column + step] : index.rows.get(address.rowIndex)?.[position.row + step];
  }
  function findField(target: ReportFieldTarget): ReportCellAddress | null {
    const cacheKey = JSON.stringify([target.field, target.datasetId, target.tableId, target.rowKey, target.reportScope]);
    if (fields.has(cacheKey)) return fields.get(cacheKey)!;
    for (const [pageIndex, page] of plan.pages.entries()) {
      if (target.reportScope !== undefined && page.meta?.reportScope !== target.reportScope) continue;
      for (let componentIndex = 0; componentIndex < page.components.length; componentIndex++) {
        const component = page.components[componentIndex]!;
        if (!component.grid) continue;
        for (const box of cells.layout(component)!.cells) {
          const address = { pageIndex, componentIndex, rowIndex: box.ri, columnIndex: box.ci };
          const context = cellAt(address);
          if (context && matchesField(context, target)) return cacheField(cacheKey, address);
        }
      }
    }
    return cacheField(cacheKey, null);
  }
  function addressResolver() { return edits ??= createEditAddressResolver(plan, cells); }
  return {
    cellAt, adjacent, findField,
    addressResolver,
    addresses: (address: ReportCellAddress) => grid(address)?.all ?? [],
    editAddress: (edit: ReportCellEdit) => addressResolver()(edit),
    editAddresses: (edit: ReportCellEdit) => addressResolver().all(edit)
  };
}
