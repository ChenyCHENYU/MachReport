import type { MatrixAxisOptions, MatrixDimensionMember, MatrixDimensionOrder, MatrixDimensionValue, MatrixHierarchyOptions } from "./matrix-model";

interface AxisNode { values: MatrixDimensionValue[]; children: Map<string, AxisNode> }
export interface MatrixAxis {
  fields: readonly string[];
  options: MatrixAxisOptions;
  hierarchy: MatrixHierarchyOptions;
  root: AxisNode;
  leaves: number;
  expanded: number;
}
export function matrixDimensionKey(fields: readonly string[], values: readonly MatrixDimensionValue[]): string {
  return JSON.stringify([fields.slice(0, values.length), values.map(value => [value === null ? "null" : typeof value, value])]);
}
export function matrixDimensionValues(row: Record<string, unknown>, fields: readonly string[]): MatrixDimensionValue[] {
  return fields.map(field => {
    const value = Object.prototype.hasOwnProperty.call(row, field) ? row[field] : null;
    if (value == null) return null;
    if (typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
    throw new Error("矩阵维度必须是有限 JSON 标量");
  });
}
export function validateMatrixHierarchy(value: MatrixHierarchyOptions, rowFields: readonly string[], columnFields: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("矩阵层级应为对象");
  for (const label of [value.emptyLabel, value.subtotalLabel, value.totalLabel]) if (label !== undefined && typeof label !== "string") throw new Error("矩阵层级标签应为字符串");
  validateAxis(value.row, rowFields.length); validateAxis(value.column, columnFields.length);
}
function validateAxis(axis: MatrixAxisOptions | undefined, depth: number): void {
  if (axis === undefined) return;
  if (!axis || typeof axis !== "object" || Array.isArray(axis)) throw new Error("矩阵轴配置应为对象");
  if (axis.labels !== undefined && (!Array.isArray(axis.labels) || axis.labels.length !== depth || axis.labels.some(label => typeof label !== "string"))) throw new Error("矩阵维度标签必须与维度字段一一对应");
  if (axis.sort !== undefined && (!Array.isArray(axis.sort) || axis.sort.length > depth || axis.sort.some(order => !["source", "asc", "desc"].includes(order)))) throw new Error("矩阵维度排序应为 source、asc 或 desc");
  if (axis.subtotals !== undefined && (!Array.isArray(axis.subtotals) || new Set(axis.subtotals).size !== axis.subtotals.length || axis.subtotals.some(level => !Number.isInteger(level) || level < 1 || level >= depth))) throw new Error("矩阵小计深度应唯一且位于 1 至末级之前");
}
export function createMatrixAxis(fields: readonly string[], options: MatrixAxisOptions | undefined, hierarchy: MatrixHierarchyOptions): MatrixAxis {
  return { fields, options: options ?? {}, hierarchy, root: { values: [], children: new Map() }, leaves: 0, expanded: 0 };
}
export function addMatrixAxisRow(axis: MatrixAxis, row: Record<string, unknown>): void {
  const values = matrixDimensionValues(row, axis.fields);
  let parent = axis.root;
  for (let depth = 1; depth <= values.length; depth++) {
    const prefix = values.slice(0, depth), key = matrixDimensionKey(axis.fields, prefix);
    let node = parent.children.get(key);
    if (!node) {
      node = { values: prefix, children: new Map() }; parent.children.set(key, node);
      if (depth === values.length) { axis.leaves++; axis.expanded++; }
      else if (axis.options.subtotals?.includes(depth)) axis.expanded++;
    }
    parent = node;
  }
}
function compareValues(a: MatrixDimensionValue, b: MatrixDimensionValue): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const left = `${typeof a}:${a}`, right = `${typeof b}:${b}`;
  return left < right ? -1 : 1;
}
function sortedChildren(node: AxisNode, order: MatrixDimensionOrder | undefined): AxisNode[] {
  const children = [...node.children.values()];
  if (order && order !== "source") children.sort((a, b) => compareValues(a.values[a.values.length - 1]!, b.values[b.values.length - 1]!) * (order === "desc" ? -1 : 1));
  return children;
}
export function matrixAxisMember(axis: MatrixAxis, values: MatrixDimensionValue[], kind: MatrixDimensionMember["kind"]): MatrixDimensionMember {
  return { key: matrixDimensionKey(axis.fields, values), kind, depth: values.length, fields: axis.fields.slice(0, values.length), values,
    labels: values.map(value => value === null ? axis.hierarchy.emptyLabel ?? "（空）" : String(value)) };
}
export function expandMatrixAxis(axis: MatrixAxis, totals: boolean): MatrixDimensionMember[] {
  const result: MatrixDimensionMember[] = [];
  function visit(parent: AxisNode): void {
    for (const node of sortedChildren(parent, axis.options.sort?.[parent.values.length])) {
      if (!node.children.size) result.push(matrixAxisMember(axis, node.values, "member"));
      else { visit(node); if (axis.options.subtotals?.includes(node.values.length)) result.push(matrixAxisMember(axis, node.values, "subtotal")); }
    }
  }
  visit(axis.root);
  if (totals && axis.leaves) result.push(matrixAxisMember(axis, [], "total"));
  return result;
}
/** Each original contributes once to a leaf and each explicitly requested prefix/total. */
export function matrixAxisKeys(axis: MatrixAxis, row: Record<string, unknown>, totals: boolean): string[] {
  const values = matrixDimensionValues(row, axis.fields);
  const keys = [matrixDimensionKey(axis.fields, values), ...(axis.options.subtotals ?? []).map(depth => matrixDimensionKey(axis.fields, values.slice(0, depth)))];
  if (totals) keys.push(matrixDimensionKey(axis.fields, []));
  return keys;
}
