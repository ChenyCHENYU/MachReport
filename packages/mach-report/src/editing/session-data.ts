import type { DatasetRows, ListComponent, ListDetail, ReportTemplate } from "../layout/paginate";
import { ReportCellEditError } from "./value";
import type { ReportCellSource } from "../schema/render-plan";

export interface ReportEditSessionPart { template: ReportTemplate; datasets: DatasetRows; sourceScope?: string }
export interface SessionRow { partIndex: number; dataset: string; rowIndex: number; row: Record<string, unknown>; binding: Pick<ListComponent, "rowKey" | "revisionField" | "sourceTokenField"> }
type RowBinding = Pick<ListComponent, "dataset" | "rowKey" | "revisionField" | "sourceTokenField"> & { relation?: { detail: ListDetail; parentRows: Record<string, unknown>[] } };

function bindings(part: ReportEditSessionPart): RowBinding[] {
  const result: RowBinding[] = [];
  for (const page of part.template.pages) for (const component of page.components) {
    if (component.kind !== "list") continue;
    result.push(component.tree ? { ...component, rowKey: component.tree.idField } : component);
    if (component.detail) result.push({ ...component.detail, relation: { detail: component.detail, parentRows: part.datasets[component.dataset] ?? [] } });
  }
  return result;
}
export function sourceDatasetKey(source: Pick<ReportCellSource, "sourceScope" | "datasetId">): string { return JSON.stringify([source.sourceScope, source.datasetId]); }
export function sourceRowKey(source: Pick<ReportCellSource, "sourceScope" | "datasetId" | "rowKey">): string { return JSON.stringify([source.sourceScope, source.datasetId, source.rowKey]); }
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
        const key = sourceRowKey({ sourceScope: part.sourceScope, datasetId: binding.dataset, rowKey });
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
      if (!datasets.has(sourceDatasetKey({ sourceScope: part.sourceScope, datasetId: binding.dataset }))) continue;
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
