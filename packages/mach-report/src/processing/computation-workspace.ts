import type { ComputedField, ComputationIssue } from "./computed";
import type { ExpressionReader } from "./expressions";

export interface CompiledComputationField {
  definition: ComputedField;
  dependencies: readonly string[];
  read: ExpressionReader;
}
export interface CachedComputationValue {
  dependencies: readonly unknown[];
  value: unknown;
  issue?: Omit<ComputationIssue, "rowIndex">;
}
export interface ComputationProgram {
  fields: readonly CompiledComputationField[];
  rows: WeakMap<object, ReadonlyMap<string, CachedComputationValue>>;
  slots: number;
  cacheRows: boolean;
}
export interface ComputationRun {
  program?: ComputationProgram;
  writes: WeakMap<object, Map<string, CachedComputationValue>>;
}
interface Workspace { programs: Map<string, ComputationProgram>; units: number; slots: number }
const MAX_PROGRAMS = 16, MAX_UNITS = 1024 * 1024, MAX_SLOTS = 500_000;
// Only private edit-session snapshots are registered. Public mutable datasets never enter this cache.
const workspaces = new WeakMap<readonly Record<string, unknown>[], Workspace>();
const SKIP_KEY = Symbol("uncacheable-computation-definition");
interface KeyBudget { nodes: number; units: number }
function typedDefinition(value: unknown, budget: KeyBudget, depth = 0): unknown {
  if (++budget.nodes > 10_000 || depth > 32) throw SKIP_KEY;
  if (value === null || value === undefined) return [String(value)];
  if (typeof value === "number") return ["number", Object.is(value, -0) ? "-0" : String(value)];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "string") {
    budget.units += value.length;
    if (budget.units > MAX_UNITS) throw SKIP_KEY;
    return ["string", value];
  }
  if (typeof value !== "object") throw SKIP_KEY;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length) throw SKIP_KEY;
    return ["array", Array.from({ length: value.length }, (_, index) => typedDefinition(ownDefinitionValue(value, String(index)), budget, depth + 1))];
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw SKIP_KEY;
  return ["object", Object.keys(value).map(key => [typedDefinition(key, budget, depth + 1), typedDefinition(ownDefinitionValue(value, key), budget, depth + 1)])];
}
function ownDefinitionValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.get || descriptor.set) throw SKIP_KEY;
  return descriptor.value;
}
function definitionKey(fields: readonly ComputedField[]): string | undefined {
  try { return JSON.stringify(typedDefinition(fields, { nodes: 0, units: 0 })); }
  catch (cause) { if (cause !== SKIP_KEY) throw cause; return undefined; }
}

export function registerComputedDataset(rows: readonly Record<string, unknown>[]): void {
  workspaces.set(rows, { programs: new Map(), units: 0, slots: 0 });
}

/** Fork cache ownership with the candidate transaction; no candidate writes can affect its baseline. */
export function forkComputedDataset(previous: readonly Record<string, unknown>[], next: readonly Record<string, unknown>[]): void {
  const source = workspaces.get(previous);
  if (!source) return;
  const workspace: Workspace = { programs: new Map(), units: source.units, slots: source.slots };
  for (const [key, program] of source.programs) {
    const rows = new WeakMap<object, ReadonlyMap<string, CachedComputationValue>>();
    next.forEach((row, index) => {
      const cached = program.rows.get(previous[index]!);
      if (cached) rows.set(row, cached);
    });
    workspace.programs.set(key, { ...program, rows });
  }
  workspaces.set(next, workspace);
}

/** No global template/data cache: each dataset keeps at most 16 programs and 1 MiB of definition keys. */
export function computedProgram(input: readonly Record<string, unknown>[], fields: readonly ComputedField[], compile: () => CompiledComputationField[]): ComputationProgram | undefined {
  const workspace = workspaces.get(input);
  if (!workspace || fields.some((field) => typeof field.expression === "string")) return;
  // Session guards reject accessors, toJSON and exotic objects before ownership is established.
  const key = definitionKey(fields);
  if (key === undefined || key.length > MAX_UNITS) return;
  const existing = workspace.programs.get(key);
  if (existing) return existing;
  const compiled = compile(), slots = input.length * compiled.reduce((sum, field) => sum + field.dependencies.length + 1, 0);
  const program: ComputationProgram = { fields: compiled, rows: new WeakMap(), slots, cacheRows: slots <= MAX_SLOTS };
  if (!program.cacheRows) return program;
  while (workspace.programs.size >= MAX_PROGRAMS || workspace.units + key.length > MAX_UNITS || workspace.slots + slots > MAX_SLOTS) {
    const oldest = workspace.programs.keys().next().value!;
    workspace.slots -= workspace.programs.get(oldest)!.slots;
    workspace.units -= oldest.length; workspace.programs.delete(oldest);
  }
  workspace.programs.set(key, program); workspace.units += key.length; workspace.slots += slots;
  return program;
}

export function cachedRowValue(run: ComputationRun, source: object, item: CompiledComputationField, row: Record<string, unknown>): CachedComputationValue | undefined {
  if ((item.definition.scope ?? "row") !== "row") return;
  const cached = run.program?.rows.get(source)?.get(item.definition.field);
  return cached?.dependencies.every((value, index) => Object.is(row[item.dependencies[index]!], value)) ? cached : undefined;
}

export function rememberRowValue(run: ComputationRun, source: object, item: CompiledComputationField, row: Record<string, unknown>, issue?: ComputationIssue): void {
  const program = run.program;
  if (!program?.cacheRows || (item.definition.scope ?? "row") !== "row") return;
  // Existing maps are shared read-only by a fork; replace instead of mutating them.
  let values = run.writes.get(source);
  if (!values) {
    values = new Map(program.rows.get(source));
    run.writes.set(source, values); program.rows.set(source, values);
  }
  values.set(item.definition.field, { dependencies: item.dependencies.map((field) => row[field]), value: row[item.definition.field],
    ...(issue ? { issue: { field: issue.field, message: issue.message } } : {}) });
}
