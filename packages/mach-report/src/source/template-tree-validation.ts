import { validateTreeOptions, validateTreeComputed, type TreeTableOptions } from "../processing/tree";
import type { ComputedField } from "../processing/computed";
import type { ValidationError } from "../schema/validate";
type ObjectValue = Record<string, unknown>;
export function validateListTree(list: ObjectValue, path: string, errors: ValidationError[]): void {
  if (list.tree === undefined) return;
  const here = `${path}.tree`;
  try {
    validateTreeOptions(list.tree as TreeTableOptions);
    const tree = list.tree as TreeTableOptions;
    if (list.matrix || list.detail || list.groupBy || Array.isArray(list.groups) && list.groups.length || list.rowVisibleWhen) throw new Error("树形布局不能同时配置普通分组、矩阵、主从或行可见条件");
    if (list.rowKey !== undefined && list.rowKey !== tree.idField) throw new Error("树形 rowKey 应与 idField 一致");
    if (!Array.isArray(list.columns) || !list.columns.some(column => column && column.field === tree.labelField && !column.hidden)) throw new Error("树形布局需要可见的标签列");
    if (Array.isArray(list.computed)) validateTreeComputed(tree, list.computed as ComputedField[]);
  } catch (cause) { errors.push({ path: here, message: cause instanceof Error ? cause.message : String(cause) }); }
}
