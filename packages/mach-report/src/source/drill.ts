import type { RenderPlan, ReportCellSource } from "../schema/render-plan";
import { createReportCellResolver, getReportCellContext, type ReportCellAddress, type ReportCellContext } from "../editing/context";
import { reportCellEditKey } from "../editing/batch";
import { resolveGridLayout } from "../render/grid-geometry";

export type ReportDrillBinding = { value: string | number | boolean } | { from: "value" | "rowKey" } | { from: "query" | "field"; field: string };
/** Serializable action metadata. URLs, scripts and automatic navigation are deliberately absent. */
export interface ReportDrillAction {
  id: string;
  label: string;
  target: { field: string; datasetId?: string; reportScope?: string; roles?: readonly string[] };
  params?: Readonly<Record<string, ReportDrillBinding>>;
}
export interface ReportDrillReturnState {
  params: Readonly<Record<string, string>>;
  address: Readonly<ReportCellAddress>;
  reportScope?: string;
  source?: Readonly<Pick<ReportCellSource, "sourceScope" | "datasetId" | "rowKey" | "field">>;
}
export interface ReportDrillRequest {
  actionId: string;
  params: Readonly<Record<string, string>>;
  returnState: Readonly<ReportDrillReturnState>;
}
export class ReportDrillError extends Error {
  constructor(readonly code: "config" | "missing-value" | "target") { super(`Report drill: ${code}`); this.name = "ReportDrillError"; }
}
function name(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 256; }
function scalar(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) || typeof value === "boolean") return String(value);
  if (typeof value === "string" && value.length > 0 && value.length <= 4096) return value;
  throw new ReportDrillError("missing-value");
}
function own(object: object, field: string): unknown { return Object.getOwnPropertyDescriptor(object, field)?.value; }
export function validateReportDrillActions(actions: readonly ReportDrillAction[]): void {
  if (!Array.isArray(actions) || actions.length > 64) throw new ReportDrillError("config");
  const ids = new Set<string>();
  for (const action of actions) {
    if (!action || !name(action.id) || !name(action.label) || !action.target || !name(action.target.field) || ids.has(action.id)) throw new ReportDrillError("config");
    ids.add(action.id);
    const target = action.target;
    if (target.datasetId !== undefined && !name(target.datasetId) || target.reportScope !== undefined && !name(target.reportScope)) throw new ReportDrillError("config");
    if (target.roles !== undefined && (!Array.isArray(target.roles) || target.roles.length > 16 || target.roles.some((role: unknown) => !name(role)))) throw new ReportDrillError("config");
    validateBindings(action.params);
  }
}
function validateBindings(params: ReportDrillAction["params"]): void {
  if (params === undefined) return;
  if (!params || typeof params !== "object" || Array.isArray(params) || Object.keys(params).length > 32) throw new ReportDrillError("config");
  for (const [key, binding] of Object.entries(params)) {
    if (!name(key) || ["__proto__", "constructor", "prototype"].includes(key) || !binding || typeof binding !== "object") throw new ReportDrillError("config");
    if ("value" in binding) { try { scalar(binding.value); } catch { throw new ReportDrillError("config"); } }
    else if (!["value", "rowKey", "query", "field"].includes(binding.from) || ((binding.from === "query" || binding.from === "field") && !name(binding.field))) throw new ReportDrillError("config");
  }
}
function matches(plan: RenderPlan, context: ReportCellContext, action: ReportDrillAction): boolean {
  const { target } = action, dataset = context.source?.datasetId ?? context.component.table?.source?.datasetId;
  return (context.source?.field ?? context.table?.columnKey) === target.field
    && (target.datasetId === undefined || dataset === target.datasetId)
    && (target.reportScope === undefined || plan.pages[context.address.pageIndex]?.meta?.reportScope === target.reportScope)
    && (target.roles ? target.roles.includes(context.table?.role ?? "") : context.table?.role !== "header");
}
/** O(action count), no row scans or listeners per cell; invoke for the focused cell only. */
export function matchReportDrillActions(plan: RenderPlan, address: ReportCellAddress, actions: readonly ReportDrillAction[]): ReportDrillAction[] {
  validateReportDrillActions(actions);
  const context = getReportCellContext(plan, address);
  return context ? actions.filter(action => matches(plan, context, action)) : [];
}
function bindingValue(binding: ReportDrillBinding, plan: RenderPlan, context: ReportCellContext, params: Readonly<Record<string, string>>): unknown {
  if ("value" in binding) return binding.value;
  switch (binding.from) {
    case "value": return context.value;
    case "rowKey": return context.source?.rowKey;
    case "query": return own(params, binding.field);
    case "field": {
      const columnIndex = context.component.table?.columnKeys.indexOf(binding.field) ?? -1;
      return columnIndex < 0 ? undefined : getReportCellContext(plan, { ...context.address, columnIndex })?.value;
    }
  }
}
/** Revalidates the current cell on activation; returns only bounded scalar values and explicit return state. */
export function createReportDrillRequest(plan: RenderPlan, address: ReportCellAddress, action: ReportDrillAction, params: Readonly<Record<string, string>> = {}): ReportDrillRequest {
  validateReportDrillActions([action]);
  const context = getReportCellContext(plan, address);
  if (!context || !matches(plan, context, action)) throw new ReportDrillError("target");
  const values = Object.fromEntries(Object.entries(action.params ?? {}).map(([key, binding]) => [key, scalar(bindingValue(binding, plan, context, params))]));
  const query = Object.entries(params);
  if (query.length > 128 || query.some(([key, value]) => !name(key) || typeof value !== "string" || value.length > 4096)) throw new ReportDrillError("config");
  const scope = plan.pages[address.pageIndex]?.meta?.reportScope;
  return Object.freeze({ actionId: action.id, params: Object.freeze(values), returnState: Object.freeze({
    params: Object.freeze(Object.fromEntries(query)), address: Object.freeze({ ...address }), ...(typeof scope === "string" ? { reportScope: scope } : {}),
    ...(context.source ? { source: Object.freeze({ sourceScope: context.source.sourceScope, datasetId: context.source.datasetId, rowKey: context.source.rowKey, field: context.source.field }) } : {})
  }) });
}

/** Resolve a stable business cell after requery/reordering; missing rows never fall back to another row. */
export function resolveReportDrillReturn(plan: RenderPlan, state: ReportDrillReturnState): ReportCellAddress | null {
  if (!state.source) return plan.pages[state.address.pageIndex]?.meta?.reportScope === state.reportScope && getReportCellContext(plan, state.address) ? { ...state.address } : null;
  const resolve = createReportCellResolver(plan), key = reportCellEditKey({ address: state.address, source: state.source });
  for (const [pageIndex, page] of plan.pages.entries()) {
    if (state.reportScope !== undefined && page.meta?.reportScope !== state.reportScope) continue;
    for (const [componentIndex, component] of page.components.entries()) {
      if (!component.grid) continue;
      for (const cell of resolveGridLayout(component.grid, component.widthMm, component.heightMm).cells) {
        const address = { pageIndex, componentIndex, rowIndex: cell.ri, columnIndex: cell.ci }, context = resolve(address);
        if (context?.source && reportCellEditKey(context) === key) return address;
      }
    }
  }
  return null;
}
