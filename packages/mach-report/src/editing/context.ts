import { resolveGridLayout } from "../render/grid-geometry";
import type { GridCell, PlanComponent, PlanTableFragment, RenderPlan, ReportCellSource } from "../schema/render-plan";

export type ReportCellValue = string | number | boolean | null;
export type ReportCellValueType = NonNullable<GridCell["valueType"]>;

/** 预览中的物理坐标；合并单元格使用左上角坐标。 */
export interface ReportCellAddress {
  pageIndex: number;
  componentIndex: number;
  rowIndex: number;
  columnIndex: number;
}

export interface ReportCellTableIdentity {
  id: string;
  /** 逻辑表行索引；跨分页的同一行保持不变。 */
  rowIndex: number;
  role: PlanTableFragment["role"];
  columnKey?: string;
}

export type ReportCellReadOnlyReason = "cell" | "formula" | "complex" | "structure";

export interface ReportCellContext {
  address: ReportCellAddress;
  cell: Readonly<GridCell>;
  component: Readonly<PlanComponent>;
  value: ReportCellValue;
  valueType: ReportCellValueType;
  table?: ReportCellTableIdentity;
  /** Stable business identity. Physical row indices must never be used as database keys. */
  source?: Readonly<ReportCellSource>;
  editable: boolean;
  readOnlyReason?: ReportCellReadOnlyReason;
}

interface LocatedCell {
  cell: GridCell;
  /** compact cells 数组中的位置，不等同于合并网格的物理列。 */
  sourceColumnIndex: number;
}

function validAddress(address: ReportCellAddress): boolean {
  if (!address || typeof address !== "object") return false;
  return [address.pageIndex, address.componentIndex, address.rowIndex, address.columnIndex]
    .every((index) => Number.isInteger(index) && index >= 0);
}

/** 与 DOM/PDF/Canvas 共用几何，避免合并单元格的物理列和数组下标错位。 */
export function locateReportGridCell(component: PlanComponent, rowIndex: number, columnIndex: number): LocatedCell | null {
  const grid = component.grid;
  if (!grid) return null;
  const row = grid.cells[rowIndex];
  if (!row) return null;
  const boxes = resolveGridLayout(grid, component.widthMm, component.heightMm).cells.filter((box) => box.ri === rowIndex);
  const sourceColumnIndex = boxes.findIndex((box) => box.ci === columnIndex);
  const cell = row[sourceColumnIndex];
  return cell ? { cell, sourceColumnIndex } : null;
}

function currentValue(cell: GridCell): ReportCellValue {
  return cell.value !== undefined ? cell.value : cell.rawText ?? cell.text ?? null;
}

function inferValueType(cell: GridCell, value: ReportCellValue): ReportCellValueType {
  if (cell.valueType) return cell.valueType;
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value === null && cell.numberFormat && /[0#?]/.test(cell.numberFormat)) return "number";
  return "text";
}

function readOnlyReason(cell: GridCell, component: PlanComponent): ReportCellReadOnlyReason | undefined {
  if (cell.editable === false) return "cell";
  if (cell.formula !== undefined) return "formula";
  if (cell.children?.length) return "complex";
  if (component.table && component.table.role !== "body" && cell.editable !== true) return "structure";
  return undefined;
}

function tableIdentity(component: PlanComponent, address: ReportCellAddress): ReportCellTableIdentity | undefined {
  const table = component.table;
  if (!table) return undefined;
  return {
    id: table.id,
    rowIndex: table.rowIndex + address.rowIndex,
    role: table.role,
    columnKey: table.columnKeys[address.columnIndex]
  };
}

function sourceIdentity(cell: GridCell, component: PlanComponent, address: ReportCellAddress): ReportCellSource | undefined {
  if (cell.source) return { ...cell.source };
  const source = component.table?.source;
  const field = component.table?.columnKeys[address.columnIndex];
  if (!source || source.rowKey === undefined || field === undefined) return undefined;
  return { ...source, rowKey: source.rowKey, field };
}

/** 缺失、被合并覆盖、显式 null 占位不生成编辑目标。 */
function cellContext(component: PlanComponent, address: ReportCellAddress, cell: GridCell): ReportCellContext {
  const value = currentValue(cell);
  const reason = readOnlyReason(cell, component);
  return {
    address: { ...address }, cell, component, value,
    valueType: inferValueType(cell, value),
    table: tableIdentity(component, address),
    source: sourceIdentity(cell, component, address),
    editable: reason === undefined,
    readOnlyReason: reason
  };
}

export function getReportCellContext(plan: RenderPlan, address: ReportCellAddress): ReportCellContext | null {
  if (!validAddress(address)) return null;
  const component = plan.pages[address.pageIndex]?.components[address.componentIndex];
  if (!component) return null;
  const located = locateReportGridCell(component, address.rowIndex, address.columnIndex);
  return located ? cellContext(component, address, located.cell) : null;
}

/** Operation-scoped index: avoids repeated geometry work without caching mutable plans globally. */
export function createReportCellResolver(plan: RenderPlan): (address: ReportCellAddress) => ReportCellContext | null {
  const components = new Map<PlanComponent, Map<string, GridCell>>();
  return (address) => {
    if (!validAddress(address)) return null;
    const component = plan.pages[address.pageIndex]?.components[address.componentIndex];
    if (!component?.grid) return null;
    let index = components.get(component);
    if (!index) {
      const sourceColumns = new Map<number, number>();
      index = new Map();
      for (const box of resolveGridLayout(component.grid, component.widthMm, component.heightMm).cells) {
        const sourceColumn = sourceColumns.get(box.ri) ?? 0;
        sourceColumns.set(box.ri, sourceColumn + 1);
        const cell = component.grid.cells[box.ri]?.[sourceColumn];
        if (cell) index.set(`${box.ri}:${box.ci}`, cell);
      }
      components.set(component, index);
    }
    const cell = index.get(`${address.rowIndex}:${address.columnIndex}`);
    return cell ? cellContext(component, address, cell) : null;
  };
}
