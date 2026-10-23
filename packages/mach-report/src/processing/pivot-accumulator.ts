import { createAggregateAccumulator, type AggregateAccumulator, type AggregateRequest } from "./aggregate";

export interface PivotDimension { key: string; label: string }
export interface PivotGroup {
  label: string;
  cells: Map<string, AggregateAccumulator[]>;
  totals?: AggregateAccumulator[];
}
/** Shared single scan: dimensions are read once per row; totals exist only when requested. */
export function accumulatePivotRows(input: readonly Record<string, unknown>[], options: {
  row(row: Record<string, unknown>): PivotDimension;
  column(row: Record<string, unknown>): PivotDimension;
  measures: readonly AggregateRequest[];
  totals?: boolean;
  check(rows: number, columns: number): void;
}) {
  const create = () => options.measures.map(measure => createAggregateAccumulator(measure));
  const groups = new Map<string, PivotGroup>(), columns = new Map<string, string>();
  const columnTotals = new Map<string, AggregateAccumulator[]>(), totals = options.totals ? create() : undefined;
  const add = (states: AggregateAccumulator[] | undefined, row: Record<string, unknown>) => states?.forEach(state => state.add(row));
  for (const row of input) {
    const r = options.row(row), c = options.column(row);
    if (!columns.has(c.key)) columns.set(c.key, c.label);
    let group = groups.get(r.key);
    if (!group) { group = { label: r.label, cells: new Map(), ...(options.totals ? { totals: create() } : {}) }; groups.set(r.key, group); }
    options.check(groups.size, columns.size);
    let cells = group.cells.get(c.key);
    if (!cells) { cells = create(); group.cells.set(c.key, cells); }
    add(cells, row);
    if (!options.totals) continue;
    let total = columnTotals.get(c.key);
    if (!total) { total = create(); columnTotals.set(c.key, total); }
    add(group.totals, row); add(total, row); add(totals, row);
  }
  return { groups, columns, columnTotals, totals };
}
