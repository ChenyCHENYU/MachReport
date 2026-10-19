import type { GridCell, PlanComponent, RenderPlan } from "./schema/render-plan";
import type { ReportCellAddress } from "./editing/context";

export type ReportCalculationOperation = "sum" | "average" | "min" | "max" | "count" | "median" | "expression";
export interface ReportCalculationSelection { anchor: ReportCellAddress; focus: ReportCellAddress }
export interface ReportSelectionCalculationOptions {
  operation?: ReportCalculationOperation;
  /** Only aggregate names, finite numeric constants, + - * / and parentheses. No cell/Excel formulas. */
  expression?: string;
  precision?: number;
  maxCells?: number;
  maxScannedCells?: number;
  signal?: AbortSignal;
  /** Cooperative scheduler; default yields to the browser/Node event loop. */
  yieldToHost?: () => Promise<void>;
}
export interface ReportSelectionCalculationResult {
  value: number | null;
  formatted: string;
  numericCells: number;
  excludedCells: number;
  selectedCells: number;
  /** IEEE-754 arithmetic; presentation rounding does not change source values. */
  precision: number;
}
export type ReportCalculationErrorCode = "selection" | "limit" | "expression" | "division" | "overflow" | "precision";
export class ReportCalculationError extends Error {
  constructor(readonly code: ReportCalculationErrorCode) { super(`Report calculation: ${code}`); this.name = "ReportCalculationError"; }
}
interface Bounds { grid: string; rowStart: number; rowEnd: number; columnStart: number; columnEnd: number; origin?: PlanComponent["table"] }
interface Work { scanned: number; maxScanned: number; signal?: AbortSignal; yieldToHost(): Promise<void> }
interface Samples { values: number[]; seen: Set<string>; excluded: number; selected: number }
function abort(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Calculation cancelled"); error.name = "AbortError"; throw error;
}
async function checkpoint(work: Work, increment = 1): Promise<void> {
  const previousChunk = Math.floor(work.scanned / 2048);
  work.scanned += increment;
  if (work.scanned > work.maxScanned) throw new ReportCalculationError("limit");
  abort(work.signal);
  if (Math.floor(work.scanned / 2048) > previousChunk) { await work.yieldToHost(); abort(work.signal); }
}
function rowOffset(component: PlanComponent): number {
  return component.table?.role === "header" ? -Math.max(1, component.grid?.cells.length ?? 1) : component.table?.rowIndex ?? 0;
}
function coordinate(plan: RenderPlan, address: ReportCellAddress, origin: ReportCellAddress) {
  if (![address.pageIndex, address.componentIndex, address.rowIndex, address.columnIndex].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new ReportCalculationError("selection");
  const component = plan.pages[address.pageIndex]?.components[address.componentIndex];
  if (!component?.grid || address.rowIndex >= component.grid.cells.length) throw new ReportCalculationError("selection");
  const columns = component.grid.colWidthsMm?.length ?? component.grid.cells.reduce((max, row) => Math.max(max, row.length), 1);
  if (address.columnIndex >= columns) throw new ReportCalculationError("selection");
  const table = component.table, source = plan.pages[origin.pageIndex]?.components[origin.componentIndex]?.table;
  if (table && source && table.id === source.id) {
    const column = source.columnKeys.indexOf(table.columnKeys[address.columnIndex] ?? "");
    if (column < 0) throw new ReportCalculationError("selection");
    return { grid: table.id, row: rowOffset(component) + address.rowIndex, column };
  }
  return { grid: `${address.pageIndex}:${address.componentIndex}`, row: address.rowIndex, column: address.columnIndex };
}
function boundsFor(plan: RenderPlan, selection: ReportCalculationSelection, maxCells: number): Bounds {
  const a = coordinate(plan, selection.anchor, selection.anchor), b = coordinate(plan, selection.focus, selection.anchor);
  if (a.grid !== b.grid) throw new ReportCalculationError("selection");
  const area = (Math.abs(a.row - b.row) + 1) * (Math.abs(a.column - b.column) + 1);
  if (!Number.isSafeInteger(area) || area > maxCells) throw new ReportCalculationError("limit");
  return { grid: a.grid, rowStart: Math.min(a.row, b.row), rowEnd: Math.max(a.row, b.row), columnStart: Math.min(a.column, b.column), columnEnd: Math.max(a.column, b.column), origin: plan.pages[selection.anchor.pageIndex]!.components[selection.anchor.componentIndex]!.table };
}
function dateFormat(format: string | undefined): boolean {
  if (!format) return false;
  const clean = format.replace(/"[^"]*"|\\.|\[(?![hms]+\])[^\]]*\]/gi, "");
  return /[ymdhs]/i.test(clean);
}
function numericValue(cell: GridCell): number | null {
  // Text identifiers, dates, booleans, blanks and formatted display text are never coerced.
  if (cell.valueType === "text" || cell.valueType === "boolean" || dateFormat(cell.numberFormat)) return null;
  const value = cell.value;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new ReportCalculationError("precision");
  return value;
}
function record(samples: Samples, cell: GridCell | null, key: string): void {
  if (samples.seen.has(key)) return;
  samples.seen.add(key); samples.selected++;
  // Renderer null/sparse entries occupy a real blank cell, so include them in exclusion counts.
  const value = cell ? numericValue(cell) : null;
  if (value === null) samples.excluded++; else samples.values.push(value);
}
function componentMatches(component: PlanComponent, pageIndex: number, componentIndex: number, bounds: Bounds): boolean {
  return bounds.origin ? component.table?.id === bounds.origin.id : `${pageIndex}:${componentIndex}` === bounds.grid;
}
function logicalColumn(component: PlanComponent, column: number, bounds: Bounds): number {
  return bounds.origin ? bounds.origin.columnKeys.indexOf(component.table!.columnKeys[column] ?? "") : column;
}
function selectedKey(component: PlanComponent, row: number, column: number, bounds: Bounds): string | null {
  const logicalRow = bounds.origin ? rowOffset(component) + row : row;
  const logicalCol = logicalColumn(component, column, bounds);
  if (logicalRow < bounds.rowStart || logicalRow > bounds.rowEnd || logicalCol < bounds.columnStart || logicalCol > bounds.columnEnd) return null;
  // Repeated headers and fragment copies have the same logical identity.
  return `${bounds.grid}:${logicalRow}:${logicalCol}`;
}
/** Earlier rows may establish active row spans, but later rows cannot affect selected cells. */
function scanRowCount(component: PlanComponent, bounds: Bounds): number {
  const offset = bounds.origin ? rowOffset(component) : 0;
  const start = Math.max(0, bounds.rowStart - offset);
  const end = Math.min(component.grid!.cells.length, bounds.rowEnd - offset + 1);
  return end > start ? end : 0;
}
async function scanComponent(component: PlanComponent, rows: number, bounds: Bounds, work: Work, samples: Samples): Promise<void> {
  const grid = component.grid!;
  if (rows > work.maxScanned) throw new ReportCalculationError("limit");
  const columnCount = grid.colWidthsMm?.length ?? grid.cells.reduce((max, row) => Math.max(max, row.length), 1);
  if (columnCount > work.maxScanned) throw new ReportCalculationError("limit");
  const occupiedUntil = new Map<number, number>();
  for (let row = 0; row < rows; row++) {
    if (row > 0 && row % 2048 === 0) { await work.yieldToHost(); abort(work.signal); }
    let column = 0;
    for (const cell of grid.cells[row]!) {
      await checkpoint(work);
      while (column < columnCount && (occupiedUntil.get(column) ?? 0) > row) column++;
      if (column >= columnCount) break;
      const span = Math.max(1, Math.min(cell?.colSpan ?? 1, columnCount - column));
      const endRow = Math.min(grid.cells.length, row + Math.max(1, cell?.rowSpan ?? 1));
      // Span work is budgeted too; a single hostile merge cannot allocate an unbounded matrix.
      if (span > 1) await checkpoint(work, span - 1);
      for (let col = column; col < column + span; col++) occupiedUntil.set(col, endRow);
      const key = selectedKey(component, row, column, bounds);
      if (key) record(samples, cell, key);
      column += span;
    }
  }
}
async function collect(plan: RenderPlan, bounds: Bounds, work: Work): Promise<Samples> {
  const samples: Samples = { values: [], seen: new Set(), excluded: 0, selected: 0 };
  for (let pageIndex = 0; pageIndex < plan.pages.length; pageIndex++) {
    await checkpoint(work);
    const page = plan.pages[pageIndex]!;
    for (let componentIndex = 0; componentIndex < page.components.length; componentIndex++) {
      await checkpoint(work);
      const component = page.components[componentIndex]!;
      if (!component.grid || !componentMatches(component, pageIndex, componentIndex, bounds)) continue;
      // Structural aggregates are excluded so selecting across printed fragments never double sums totals.
      if (component.table && component.table.role !== "body") continue;
      const rows = scanRowCount(component, bounds);
      if (rows) await scanComponent(component, rows, bounds, work, samples);
    }
  }
  return samples;
}
function finite(value: number): number {
  if (!Number.isFinite(value)) throw new ReportCalculationError("overflow");
  return value;
}
function sum(values: readonly number[]): number {
  let total = 0, compensation = 0;
  for (const value of values) {
    const corrected = value - compensation, next = finite(total + corrected);
    compensation = (next - total) - corrected; total = next;
  }
  return total;
}
async function median(values: readonly number[], work: Work): Promise<number> {
  let current = [...values], target = new Array<number>(values.length);
  // Cooperative merge sort avoids an uninterruptible native sort for a large selection.
  for (let width = 1; width < values.length; width *= 2) {
    for (let start = 0; start < values.length; start += width * 2) {
      const middle = Math.min(start + width, values.length), end = Math.min(start + width * 2, values.length);
      let left = start, right = middle;
      for (let index = start; index < end; index++) {
        target[index] = right >= end || left < middle && current[left]! <= current[right]! ? current[left++]! : current[right++]!;
        // Sorting has its own bounded O(n log n) work, while scan budget protects input traversal.
        if (index % 2048 === 0) { await work.yieldToHost(); abort(work.signal); }
      }
    }
    [current, target] = [target, current];
  }
  const index = Math.floor(current.length / 2);
  return current.length % 2 ? current[index]! : finite(current[index - 1]! / 2 + current[index]! / 2);
}
interface Aggregates { SUM: number; AVERAGE: number; AVG: number; MIN: number; MAX: number; COUNT: number; MEDIAN?: number }
function aggregates(values: readonly number[]): Aggregates {
  const total = sum(values);
  let min = Infinity, max = -Infinity;
  for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
  return { SUM: total, AVERAGE: total / values.length, AVG: total / values.length, MIN: min, MAX: max, COUNT: values.length };
}
/** A tiny arithmetic parser: no functions, property access, globals, assignments or executable source. */
export function evaluateReportAggregateExpression(expression: string, values: Readonly<Record<string, number>>): number {
  if (typeof expression !== "string" || expression.length > 256) throw new ReportCalculationError("expression");
  const tokens = expression.toUpperCase().match(/(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?|[A-Z_]+|[()+\-*/]|\S/g) ?? [];
  if (!tokens.length || tokens.length > 64) throw new ReportCalculationError("expression");
  let position = 0;
  function atom(depth: number): number {
    if (depth > 16) throw new ReportCalculationError("expression");
    const token = tokens[position++];
    if (token === "+" || token === "-") return (token === "-" ? -1 : 1) * atom(depth + 1);
    if (token === "(") { const value = expressionAt(0, depth + 1); if (tokens[position++] !== ")") throw new ReportCalculationError("expression"); return value; }
    if (token && /^(?:SUM|AVERAGE|AVG|MIN|MAX|COUNT|MEDIAN)$/.test(token) && Object.prototype.hasOwnProperty.call(values, token)) return finite(values[token]!);
    if (token && /^(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?$/.test(token)) return finite(Number(token));
    throw new ReportCalculationError("expression");
  }
  function expressionAt(minPrecedence: number, depth: number): number {
    let left = atom(depth);
    while (position < tokens.length) {
      const operator = tokens[position]!, precedence = operator === "+" || operator === "-" ? 1 : operator === "*" || operator === "/" ? 2 : 0;
      if (!precedence || precedence < minPrecedence) break;
      position++; const right = expressionAt(precedence + 1, depth + 1);
      if (operator === "/" && right === 0) throw new ReportCalculationError("division");
      left = finite(operator === "+" ? left + right : operator === "-" ? left - right : operator === "*" ? left * right : left / right);
    }
    return left;
  }
  const result = expressionAt(1, 0);
  if (position !== tokens.length) throw new ReportCalculationError("expression");
  return result;
}
function budgets(options: ReportSelectionCalculationOptions) {
  const maxCells = options.maxCells ?? 100_000, maxScanned = options.maxScannedCells ?? 200_000, precision = options.precision ?? 2;
  if (![maxCells, maxScanned].every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 2_000_000)) throw new ReportCalculationError("limit");
  if (!Number.isInteger(precision) || precision < 0 || precision > 12) throw new ReportCalculationError("precision");
  return { maxCells, maxScanned, precision };
}
/** Read-only local analysis. Never changes the plan, formulas, datasets or business persistence. */
export async function calculateReportSelection(plan: RenderPlan, selection: ReportCalculationSelection, options: ReportSelectionCalculationOptions = {}): Promise<ReportSelectionCalculationResult> {
  const limits = budgets(options);
  const work: Work = { scanned: 0, maxScanned: limits.maxScanned, signal: options.signal, yieldToHost: options.yieldToHost ?? (() => new Promise((resolve) => setTimeout(resolve, 0))) };
  abort(work.signal);
  const samples = await collect(plan, boundsFor(plan, selection, limits.maxCells), work);
  const operation = options.operation ?? "sum";
  if (!["sum", "average", "min", "max", "count", "median", "expression"].includes(operation)) throw new ReportCalculationError("expression");
  let value: number | null = null;
  if (operation === "count") value = samples.values.length;
  else if (samples.values.length) {
    if (operation === "median") value = await median(samples.values, work);
    else {
      const summaries = aggregates(samples.values);
      if (operation === "expression") {
        if (/\bMEDIAN\b/i.test(options.expression ?? "")) summaries.MEDIAN = await median(samples.values, work);
        value = evaluateReportAggregateExpression(options.expression ?? "", summaries as unknown as Record<string, number>);
      } else value = summaries[operation.toUpperCase() as "SUM" | "AVERAGE" | "MIN" | "MAX"];
    }
  }
  abort(work.signal);
  if (value !== null && Number.isInteger(value) && !Number.isSafeInteger(value)) throw new ReportCalculationError("precision");
  return { value, formatted: value === null ? "—" : value.toFixed(limits.precision), numericCells: samples.values.length, excludedCells: samples.excluded, selectedCells: samples.selected, precision: limits.precision };
}
