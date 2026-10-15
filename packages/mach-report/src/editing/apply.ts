import type { GridCell, PlanComponent, RenderPlan } from "../schema/render-plan";
import {
  getReportCellContext, locateReportGridCell,
  type ReportCellAddress, type ReportCellContext, type ReportCellTableIdentity, type ReportCellValue
} from "./context";
import { formatReportCellEdit, parseReportCellInput, ReportCellEditError } from "./value";

export interface ReportCellEdit {
  address: ReportCellAddress;
  table?: ReportCellTableIdentity;
  previousValue: ReportCellValue;
  previousText: string;
  value: ReportCellValue;
  text: string;
}

/** 生成可供宿主持久化/审计的补丁；不修改 plan 或宿主业务对象。 */
export function createReportCellEdit(plan: RenderPlan, address: ReportCellAddress, input: ReportCellValue): ReportCellEdit {
  const context = getReportCellContext(plan, address);
  if (!context) throw new ReportCellEditError("missing");
  if (!context.editable) throw new ReportCellEditError("readonly");
  const value = parseReportCellInput(context, input);
  return {
    address: { ...address }, table: context.table,
    previousValue: context.value, previousText: context.cell.text ?? "",
    value, text: formatReportCellEdit(context, value)
  };
}

function sameTableCell(context: ReportCellContext, candidate: ReportCellContext): boolean {
  const table = context.table;
  const other = candidate.table;
  if (!table || !other || table.columnKey === undefined) return false;
  return table.id === other.id && table.rowIndex === other.rowIndex && table.role === other.role && table.columnKey === other.columnKey;
}

function updateCell(component: PlanComponent, context: ReportCellContext, edit: ReportCellEdit): PlanComponent {
  const grid = component.grid!;
  const { rowIndex, columnIndex } = context.address;
  const located = locateReportGridCell(component, rowIndex, columnIndex)!;
  const cells = [...grid.cells];
  const row = [...cells[rowIndex]!];
  const text = formatReportCellEdit(context, edit.value);
  const cell: GridCell = { ...located.cell, value: edit.value, text, rawText: text };
  row[located.sourceColumnIndex] = cell;
  cells[rowIndex] = row;
  return { ...component, grid: { ...grid, cells } };
}

function candidateColumns(component: PlanComponent, context: ReportCellContext): number[] {
  const keys = component.table?.columnKeys;
  const key = context.table?.columnKey;
  return keys && key !== undefined ? keys.flatMap((candidate, index) => candidate === key ? [index] : []) : [];
}

function updateMirroredComponent(
  plan: RenderPlan, component: PlanComponent, pageIndex: number, componentIndex: number,
  context: ReportCellContext, edit: ReportCellEdit
): PlanComponent {
  const table = component.table;
  const identity = context.table;
  if (!table || !identity || table.id !== identity.id || table.role !== identity.role || !component.grid) return component;
  const rowIndex = identity.rowIndex - table.rowIndex;
  if (rowIndex < 0 || rowIndex >= component.grid.cells.length) return component;
  let next = component;
  for (const columnIndex of candidateColumns(component, context)) {
    const candidate = getReportCellContext(plan, { pageIndex, componentIndex, rowIndex, columnIndex });
    if (candidate?.editable && sameTableCell(context, candidate)) next = updateCell(next, candidate, edit);
  }
  return next;
}

function updatePlanComponent(
  plan: RenderPlan, component: PlanComponent, pageIndex: number, componentIndex: number,
  context: ReportCellContext, edit: ReportCellEdit
): PlanComponent {
  const address = context.address;
  if (context.table?.columnKey !== undefined) return updateMirroredComponent(plan, component, pageIndex, componentIndex, context, edit);
  if (address.pageIndex === pageIndex && address.componentIndex === componentIndex) return updateCell(component, context, edit);
  return component;
}

/** 复制发生变化的页/组件/行；原计划保持不变，并拒绝覆盖已改变的单元格。 */
export function applyReportCellEdit(plan: RenderPlan, edit: ReportCellEdit): RenderPlan {
  const context = getReportCellContext(plan, edit.address);
  if (!context) throw new ReportCellEditError("missing");
  if (!context.editable) throw new ReportCellEditError("readonly");
  if (!Object.is(context.value, edit.previousValue) || (context.cell.text ?? "") !== edit.previousText) throw new ReportCellEditError("conflict");
  const value = parseReportCellInput(context, edit.value);
  const normalized = { ...edit, value, text: formatReportCellEdit(context, value) };
  if (Object.is(value, context.value) && normalized.text === context.cell.text) return plan;
  const pages = plan.pages.map((page, pageIndex) => {
    const components = page.components.map((component, componentIndex) => updatePlanComponent(plan, component, pageIndex, componentIndex, context, normalized));
    return components.every((component, index) => component === page.components[index]) ? page : { ...page, components };
  });
  return { ...plan, pages };
}
