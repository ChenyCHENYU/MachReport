import { createAggregateAccumulator, type AggregateAccumulator, type AggregateDefinition } from "./aggregate";
import { computeDataset, type ComputedDatasetOptions, type ComputedField } from "./computed";

type DataRow = Record<string, unknown>;
/** A serialized tree contract. Sibling and root order follow input order. */
export interface TreeTableOptions {
  input: "flat" | "nested";
  idField: string;
  /** Flat roots have null/undefined parent values. */
  parentField?: string;
  /** Nested child arrays, defaults to children. Every node still needs an ID. */
  childrenField?: string;
  labelField: string;
  indentMm?: number;
  orphan?: "error" | "root";
  /** Source preserves parent values; leaf-aggregate derives only parents from descendant leaves. */
  parentValues?: "source" | "leaf-aggregate";
  aggregates?: AggregateDefinition[];
  maxRows?: number;
  maxDepth?: number;
  /** Bounded leaf-to-ancestor aggregate work; default one million. */
  maxAggregationVisits?: number;
}
export interface TreeRow {
  row: DataRow;
  original: DataRow;
  key: string | number;
  depth: number;
  hasChildren: boolean;
}
export interface TreeTable {
  rows: DataRow[];
  entries: TreeRow[];
  leaves: DataRow[];
}
interface TreeNode { original: DataRow; parent?: TreeNode; children: TreeNode[]; key: string | number; depth: number; row: DataRow }
interface TreeLimits { rows: number; depth: number; visits: number }
export class TreeRowLimitError extends Error {
  readonly code = "tree-row-limit";
  constructor(readonly limit: number) { super(`树节点超出行数预算 ${limit}`); this.name = "TreeRowLimitError"; }
}
function bounded(value: number | undefined, fallback: number, ceiling: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1 || result > ceiling) throw new Error(`${name}应为 1–${ceiling} 的整数`);
  return result;
}
function limitsFor(options: TreeTableOptions): TreeLimits {
  return { rows: bounded(options.maxRows, 100000, 1000000, "树行数预算"), depth: bounded(options.maxDepth, 64, 256, "树深度预算"), visits: bounded(options.maxAggregationVisits, 1000000, 10000000, "树聚合访问预算") };
}
function name(value: unknown): value is string { return typeof value === "string" && !!value.trim(); }
function fieldName(value: unknown): value is string { return name(value) && !["__proto__", "prototype", "constructor"].includes(value); }
function identity(value: unknown): string | number {
  if (name(value) || typeof value === "number" && Number.isFinite(value)) return value as string | number;
  throw new Error("树节点业务键应为非空字符串或有限数字");
}
function keyOf(value: string | number): string { return JSON.stringify([typeof value, value]); }
export function treeStructureFields(options: TreeTableOptions): string[] {
  return [options.idField, ...(options.input === "flat" ? [options.parentField ?? ""] : [options.childrenField ?? "children"])];
}
export function validateTreeComputed(options: TreeTableOptions, fields?: readonly ComputedField[]): void {
  const reserved = treeStructureFields(options);
  if (fields?.some(field => field.scope && field.scope !== "row" || reserved.includes(field.field))) throw new Error("树形布局仅支持不覆盖结构键的当前行计算");
}
function active(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("树报表处理已取消"); error.name = "AbortError"; throw error;
}
function checkAggregates(options: TreeTableOptions): void {
  const values = options.aggregates ?? [];
  if (!Array.isArray(values) || values.length > 32) throw new Error("树聚合最多 32 项");
  if (options.parentValues !== "leaf-aggregate" && values.length) throw new Error("树聚合需显式选择 leaf-aggregate 父级取值策略");
  if (options.parentValues === "leaf-aggregate" && !values.length) throw new Error("叶子聚合策略至少需要一个聚合字段");
  const names = new Set<string>();
  for (const item of values) {
    if (!item || !fieldName(item.field) || names.has(item.field)) throw new Error("树聚合输出字段应安全、非空且唯一");
    for (const field of [item.valueField, item.weightField]) if (field !== undefined && !fieldName(field)) throw new Error("树聚合来源字段应安全且非空");
    if ([...treeStructureFields(options), options.labelField].includes(item.field)) throw new Error("树聚合不能覆盖结构键或标签字段");
    names.add(item.field);
    createAggregateAccumulator({ ...item, field: item.valueField ?? item.field });
  }
}
function checkFields(options: TreeTableOptions): void {
  if (!fieldName(options.idField) || !fieldName(options.labelField)) throw new Error("树需要安全的业务键和标签字段");
  if (options.input === "flat" && (!fieldName(options.parentField) || options.parentField === options.idField)) throw new Error("扁平树需要独立的父键字段");
  if (options.childrenField !== undefined && !fieldName(options.childrenField)) throw new Error("子节点字段应安全且非空");
  if (options.input === "nested" && [options.idField, options.labelField].includes(options.childrenField ?? "children")) throw new Error("子节点字段不能覆盖业务键或标签字段");
}
/** Validates runtime inputs too, so direct core calls cannot bypass template checks. */
export function validateTreeOptions(options: TreeTableOptions): void {
  if (!options || typeof options !== "object" || !["flat", "nested"].includes(options.input)) throw new Error("树输入应为 flat 或 nested");
  checkFields(options);
  if (options.orphan !== undefined && !["error", "root"].includes(options.orphan)) throw new Error("树孤儿策略应为 error 或 root");
  if (options.parentValues !== undefined && !["source", "leaf-aggregate"].includes(options.parentValues)) throw new Error("未知树父级取值策略");
  if (options.indentMm !== undefined && (!Number.isFinite(options.indentMm) || options.indentMm < 0 || options.indentMm > 20)) throw new Error("树每级缩进应为 0–20 mm");
  limitsFor(options); checkAggregates(options);
}
function node(row: DataRow, options: TreeTableOptions, index: Map<string, TreeNode>, limits: TreeLimits): TreeNode {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("树节点应为对象");
  if (index.size >= limits.rows) throw new TreeRowLimitError(limits.rows);
  const key = identity(row[options.idField]), token = keyOf(key);
  if (index.has(token)) throw new Error(`树节点业务键重复：${String(key)}`);
  const result: TreeNode = { original: row, row, key, depth: 0, children: [] }; index.set(token, result); return result;
}
function flatNodes(input: readonly DataRow[], options: TreeTableOptions, index: Map<string, TreeNode>, limits: TreeLimits, signal?: AbortSignal): TreeNode[] {
  for (const row of input) { active(signal); node(row, options, index, limits); }
  const roots: TreeNode[] = [];
  for (const entry of index.values()) {
    active(signal);
    const value = entry.row[options.parentField!];
    if (value == null) { roots.push(entry); continue; }
    const parent = index.get(keyOf(identity(value)));
    if (!parent) {
      if (options.orphan !== "root") throw new Error(`树节点 ${String(entry.key)} 的父节点不存在`);
      roots.push(entry); continue;
    }
    if (parent === entry) throw new Error("树节点不能以自身为父节点");
    entry.parent = parent; parent.children.push(entry);
  }
  return roots;
}
interface Frame { rows: readonly DataRow[]; next: number; parent?: TreeNode }
function nestedNodes(input: readonly DataRow[], options: TreeTableOptions, index: Map<string, TreeNode>, limits: TreeLimits, signal?: AbortSignal): TreeNode[] {
  const roots: TreeNode[] = [], stack: Frame[] = [{ rows: input, next: 0 }];
  while (stack.length) {
    active(signal);
    const frame = stack[stack.length - 1]!;
    if (frame.next >= frame.rows.length) { stack.pop(); continue; }
    const entry = node(frame.rows[frame.next++]!, options, index, limits);
    entry.parent = frame.parent; entry.depth = stack.length - 1;
    if (stack.length > limits.depth) throw new Error(`树节点超出深度预算 ${limits.depth}`);
    (frame.parent?.children ?? roots).push(entry);
    const children = entry.row[options.childrenField ?? "children"];
    if (children == null) continue;
    if (!Array.isArray(children)) throw new Error("嵌套树 children 字段应为数组");
    if (children.length) stack.push({ rows: children, next: 0, parent: entry });
  }
  return roots;
}
function orderedNodes(roots: TreeNode[], total: number, limits: TreeLimits, signal?: AbortSignal): TreeNode[] {
  const result: TreeNode[] = [], stack: Array<{ nodes: TreeNode[]; next: number }> = [{ nodes: roots, next: 0 }];
  while (stack.length) {
    active(signal);
    const frame = stack[stack.length - 1]!;
    if (frame.next >= frame.nodes.length) { stack.pop(); continue; }
    if (stack.length > limits.depth) throw new Error(`树节点超出深度预算 ${limits.depth}`);
    const entry = frame.nodes[frame.next++]!; entry.depth = stack.length - 1; result.push(entry);
    if (entry.children.length) stack.push({ nodes: entry.children, next: 0 });
  }
  if (result.length !== total) throw new Error("树父子关系存在循环");
  return result;
}
function leafAggregates(nodes: TreeNode[], options: TreeTableOptions, limits: TreeLimits, signal?: AbortSignal): void {
  if (options.parentValues !== "leaf-aggregate") return;
  const definitions = options.aggregates!, accumulators = new Map<TreeNode, AggregateAccumulator[]>();
  for (const entry of nodes) if (entry.children.length) accumulators.set(entry, definitions.map(item => createAggregateAccumulator({ ...item, field: item.valueField ?? item.field })));
  let visits = 0;
  for (const leaf of nodes) {
    if (leaf.children.length) continue;
    for (let parent = leaf.parent; parent; parent = parent.parent) {
      active(signal);
      visits += definitions.length;
      if (visits > limits.visits) throw new Error(`树聚合超出访问预算 ${limits.visits}`);
      for (const accumulator of accumulators.get(parent)!) accumulator.add(leaf.row);
    }
  }
  for (const [parent, values] of accumulators) {
    parent.row = { ...parent.row };
    definitions.forEach((definition, i) => { parent.row[definition.field] = values[i]!.value(); });
  }
}
function nodesFor(input: readonly DataRow[], options: TreeTableOptions, signal?: AbortSignal): TreeNode[] {
  validateTreeOptions(options); active(signal);
  if (!Array.isArray(input)) throw new Error("树数据应为节点数组");
  const limits = limitsFor(options), index = new Map<string, TreeNode>();
  const roots = options.input === "flat" ? flatNodes(input, options, index, limits, signal) : nestedNodes(input, options, index, limits, signal);
  return orderedNodes(roots, index.size, limits, signal);
}
/** Validation/estimation keeps only original references and never computes aggregate copies. */
export function flattenTreeInput(input: readonly DataRow[], options: TreeTableOptions, signal?: AbortSignal): DataRow[] {
  return nodesFor(input, options, signal).map(entry => entry.original);
}
/** O(n) identity index, iterative bounded traversal, no input mutation or recursive stack. */
export function createTreeTable(input: readonly DataRow[], options: TreeTableOptions, execution: { signal?: AbortSignal; computed?: ComputedDatasetOptions } = {}): TreeTable {
  const nodes = nodesFor(input, options, execution.signal);
  validateTreeComputed(options, execution.computed?.fields);
  if (execution.computed?.fields.length) {
    const rows = computeDataset(nodes.map(entry => entry.row), { ...execution.computed, signal: execution.signal }).rows;
    nodes.forEach((entry, i) => { entry.row = rows[i]!; });
  }
  leafAggregates(nodes, options, limitsFor(options), execution.signal);
  return { rows: nodes.map(entry => entry.row), entries: nodes.map(entry => ({ row: entry.row, original: entry.original, key: entry.key, depth: entry.depth, hasChildren: !!entry.children.length })), leaves: nodes.filter(entry => !entry.children.length).map(entry => entry.row) };
}
