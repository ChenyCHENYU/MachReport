import type { DatasetRows, ListComponent, ListDetail, ReportTemplate } from "../layout/paginate";
import { ReportCellEditError } from "./value";
import type { ReportCellSource } from "../schema/render-plan";

export interface ReportEditSessionPart { template: ReportTemplate; datasets: DatasetRows }
export interface SessionRow { partIndex: number; dataset: string; rowIndex: number; row: Record<string, unknown>; binding: Pick<ListComponent, "rowKey" | "revisionField" | "sourceTokenField"> }
type RowBinding = Pick<ListComponent, "dataset" | "rowKey" | "revisionField" | "sourceTokenField"> & { relation?: { detail: ListDetail; parentRows: Record<string, unknown>[] } };

interface FingerprintState { first: number; second: number; count: number; nodes: number; active: Set<object> }
function feedFingerprint(state: FingerprintState, value: string): void {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index); state.first = Math.imul(state.first ^ code, 16777619); state.second = Math.imul(state.second, 33) ^ code; state.count++;
  }
}
function fingerprintProperty(value: object, key: string, state: FingerprintState): void {
  const property = Object.getOwnPropertyDescriptor(value, key);
  if (!property || property.get || property.set) throw new ReportCellEditError("conflict");
  feedFingerprint(state, `${key.length}:${key}`); fingerprintValue(property.value, state);
}
function fingerprintObject(value: object, state: FingerprintState): void {
  if (Object.getOwnPropertyDescriptor(value, "toJSON")) throw new ReportCellEditError("conflict");
  if (state.active.has(value)) throw new ReportCellEditError("conflict");
  state.active.add(value);
  if (value instanceof Date) feedFingerprint(state, `date:${Date.prototype.getTime.call(value)};`);
  else {
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new ReportCellEditError("conflict");
    const keys = Object.keys(value);
    feedFingerprint(state, `${Array.isArray(value) ? "array" : "object"}:${Array.isArray(value) ? value.length : keys.length}:{`);
    keys.forEach((key) => fingerprintProperty(value, key, state)); feedFingerprint(state, "}");
  }
  state.active.delete(value);
}
function fingerprintValue(value: unknown, state: FingerprintState): void {
  if (++state.nodes > 1_000_000) throw new ReportCellEditError("limit");
  if (value === null) { feedFingerprint(state, "null;"); return; }
  if (typeof value === "object") { fingerprintObject(value, state); return; }
  if (typeof value === "function" || typeof value === "symbol") throw new ReportCellEditError("conflict");
  const text = String(value); feedFingerprint(state, `${typeof value}:${text.length}:${text};`);
}
/** 不保留副本，也不执行 toJSON/getter；首次编辑前锁定原始数据属性口径。 */
export function sessionFingerprint(parts: readonly ReportEditSessionPart[]): string {
  const state: FingerprintState = { first: 2166136261, second: 5381, count: 0, nodes: 0, active: new Set() };
  fingerprintValue(parts, state);
  return `${state.count}:${state.first >>> 0}:${state.second >>> 0}`;
}
function cloneValue(value: unknown, active: Set<object>, budget: { nodes: number; text: number }): unknown {
  if (++budget.nodes > 1_000_000) throw new ReportCellEditError("limit");
  if (typeof value === "string") { budget.text += value.length; if (budget.text > 32 * 1024 * 1024) throw new ReportCellEditError("limit"); }
  if (value === null || typeof value !== "object") return value;
  if (active.has(value)) throw new ReportCellEditError("conflict");
  if (value instanceof Date) return new Date(Date.prototype.getTime.call(value));
  active.add(value);
  const copy = Array.isArray(value) ? value.map((item) => cloneValue(item, active, budget)) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item, active, budget)]));
  active.delete(value);
  return copy;
}
export function snapshotSessionParts(parts: readonly ReportEditSessionPart[]): ReportEditSessionPart[] {
  return cloneValue(parts, new Set(), { nodes: 0, text: 0 }) as ReportEditSessionPart[];
}
function bindings(part: ReportEditSessionPart): RowBinding[] {
  const result: RowBinding[] = [];
  for (const page of part.template.pages) for (const component of page.components) {
    if (component.kind !== "list") continue;
    result.push(component.tree ? { ...component, rowKey: component.tree.idField } : component);
    if (component.detail) result.push({ ...component.detail, relation: { detail: component.detail, parentRows: part.datasets[component.dataset] ?? [] } });
  }
  return result;
}
export function sourceRowKey(source: Pick<ReportCellSource, "datasetId" | "rowKey">): string { return JSON.stringify([source.datasetId, source.rowKey]); }
/** 一次事务只建立一次索引，批量编辑不退化为 edits × dataset rows。 */
export function createSessionRowResolver(parts: readonly ReportEditSessionPart[]): (source: Readonly<ReportCellSource>) => SessionRow[] {
  const index = new Map<string, SessionRow[]>(), seen = new Set<string>();
  parts.forEach((part, partIndex) => {
    for (const binding of bindings(part)) {
      if (!binding.rowKey) continue;
      const relation = binding.relation;
      const parents = relation ? new Set(relation.parentRows.map((row) => JSON.stringify(row[relation.detail.parentKey]))) : undefined;
      (part.datasets[binding.dataset] ?? []).forEach((row, rowIndex) => {
        if (relation && !parents!.has(JSON.stringify(row[relation.detail.foreignKey]))) return;
        const rowKey = row[binding.rowKey!];
        if (typeof rowKey !== "string" && typeof rowKey !== "number") return;
        const identity = `${partIndex}:${binding.dataset}:${rowIndex}:${binding.rowKey}`;
        if (seen.has(identity)) return;
        seen.add(identity);
        const key = sourceRowKey({ datasetId: binding.dataset, rowKey });
        const found = index.get(key) ?? [];
        found.push({ partIndex, dataset: binding.dataset, rowIndex, row, binding }); index.set(key, found);
      });
    }
  });
  return (source) => {
    const rows = index.get(sourceRowKey(source));
    if (!rows?.length) throw new ReportCellEditError("missing");
    if (new Set(rows.map((row) => `${row.partIndex}:${row.dataset}`)).size !== rows.length) throw new ReportCellEditError("conflict");
    return rows;
  };
}
/** COW 只复制被修改的数据集和行；未修改大数据集保持同一快照。 */
export function updateSessionRows(parts: readonly ReportEditSessionPart[], changes: readonly { row: SessionRow; field: string; value: unknown }[]): ReportEditSessionPart[] {
  const next = parts.map((part) => ({ ...part, datasets: { ...part.datasets } }));
  const copied = new Set<string>();
  for (const { row, field, value } of changes) {
    const part = next[row.partIndex]!, key = `${row.partIndex}:${row.dataset}`;
    if (!copied.has(key)) { part.datasets[row.dataset] = [...part.datasets[row.dataset]!]; copied.add(key); }
    part.datasets[row.dataset]![row.rowIndex] = { ...part.datasets[row.dataset]![row.rowIndex], [field]: value };
  }
  return next;
}
/** ReportEditResult tokens are dataset-wide, matching applyReportEditResult semantics. */
export function sessionConcurrencyChanges(parts: readonly ReportEditSessionPart[], datasets: ReadonlySet<string>, result: { revision?: string | number; sourceToken?: string }): Array<{ row: SessionRow; field: string; value: unknown }> {
  const changes: Array<{ row: SessionRow; field: string; value: unknown }> = [];
  const seen = new Set<string>();
  parts.forEach((part, partIndex) => {
    for (const binding of bindings(part)) {
      if (!datasets.has(binding.dataset)) continue;
      (part.datasets[binding.dataset] ?? []).forEach((row, rowIndex) => {
        const target: SessionRow = { partIndex, dataset: binding.dataset, rowIndex, row, binding };
        for (const [field, value] of [[binding.revisionField, result.revision], [binding.sourceTokenField, result.sourceToken]] as const) {
          if (!field || value === undefined) continue;
          const key = `${partIndex}:${binding.dataset}:${rowIndex}:${field}`;
          if (!seen.has(key)) { seen.add(key); changes.push({ row: target, field, value }); }
        }
      });
    }
  });
  return changes;
}
