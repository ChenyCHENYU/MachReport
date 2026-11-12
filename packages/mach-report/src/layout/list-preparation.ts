import type { DatasetRows, PaginateOptions, ReportTemplate } from "./paginate";
import type { ListComponent } from "./list-model";
import { computeDataset, iterateComputedDataset } from "../processing/computed";
import { compileReportPredicate } from "../processing/predicate";
import { drainCooperatively } from "../processing/cooperative";

type Row = Record<string, unknown>;
interface PreparedRows { rows: Row[]; originals?: Map<Row, Row> }
interface Entry { input: Row[]; prepared: PreparedRows }
const workspaces = new WeakMap<DatasetRows, Map<ListComponent, Entry>>();
type Options = Pick<PaginateOptions, "formula" | "signal">;
function pure(list: ListComponent, options: Options): boolean {
  return !options.formula && !list.tree && !list.computed?.some(field => typeof field.expression === "string");
}
/** A request-local lifetime over private snapshots only; release on every exit. */
export function registerListPreparation(datasets: DatasetRows): () => void {
  workspaces.set(datasets, new Map());
  return () => { workspaces.delete(datasets); };
}
function finish(list: ListComponent, input: Row[], computed: Row[]): PreparedRows {
  const originals = computed === input ? undefined : new Map(computed.map((row, index) => [row, input[index]!]));
  const rows = list.rowVisibleWhen ? computed.filter(compileReportPredicate(list.rowVisibleWhen)) : computed;
  return { rows, originals };
}
export function preparedListRows(list: ListComponent, input: Row[], datasets: DatasetRows, options: Options): PreparedRows {
  const workspace = pure(list, options) ? workspaces.get(datasets) : undefined;
  const found = workspace?.get(list);
  if (found?.input === input) return found.prepared;
  const computed = list.computed?.length ? computeDataset(input, { fields: list.computed, ...options }).rows : input;
  const prepared = finish(list, input, computed);
  workspace?.set(list, { input, prepared });
  return prepared;
}
function* prepareRows(list: ListComponent, input: Row[], options: Options): Generator<void, PreparedRows> {
  const computed = list.computed?.length ? (yield* iterateComputedDataset(input, { fields: list.computed, ...options })).rows : input;
  const originals = computed === input ? undefined : new Map<Row, Row>();
  const predicate = list.rowVisibleWhen ? compileReportPredicate(list.rowVisibleWhen) : undefined;
  const rows: Row[] = predicate ? [] : computed;
  for (const [index, row] of computed.entries()) {
    originals?.set(row, input[index]!);
    if (predicate?.(row)) rows.push(row);
    yield;
  }
  return { rows, originals };
}
/** Prewarm declarative computation/filtering before the first page. Matrix
 * shape preflight and layout then read the same result, never Provider data. */
export async function prepareOwnedLists(template: ReportTemplate, datasets: DatasetRows, options: Options): Promise<void> {
  const workspace = workspaces.get(datasets);
  if (!workspace) return;
  for (const page of template.pages) for (const component of page.components) {
    if (component.kind !== "list") continue;
    const list = component;
    if (!pure(list, options) || (!list.computed?.length && !list.rowVisibleWhen)) continue;
    const input = datasets[list.dataset] ?? [];
    const prepared = await drainCooperatively(prepareRows(list, input, options), options.signal);
    workspace.set(list, { input, prepared });
  }
}
