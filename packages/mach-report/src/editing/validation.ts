import { createTreeTable, type TreeTableOptions } from "../processing/tree";
import { compileReportPredicate, type ReportPredicate } from "../processing/predicate";
import { computeDataset, type FormulaAdapter, type ComputedField } from "../processing/computed";
import { aggregateRows, type AggregateDefinition } from "../processing/aggregate";
import { computationFieldName } from "../processing/expressions";
export interface ReportValidationRule {
  id: string;
  /** Optional target; omitted applies to each candidate dataset. */
  dataset?: string;
  assert: ReportPredicate;
  when?: ReportPredicate;
  field?: string;
  severity?: "error" | "warning";
  message: string;
  scope?: "row" | "dataset";
  /** Dataset-scope assertions read this explicit summary row, never an arbitrary detail row. */
  aggregates?: readonly AggregateDefinition[];
}
export interface ReportValidationIssue {
  ruleId: string;
  rowKey?: string | number;
  rowIndex?: number;
  field?: string;
  dataset?: string;
  sourceScope?: string;
  severity: "error" | "warning";
  message: string;
}
export interface ReportDatasetValidationOptions {
  rules: readonly ReportValidationRule[];
  rowKey?: string;
  computed?: readonly ComputedField[];
  /** Explicit trusted engine, shared with pagination; never read from a serialized template. */
  formula?: FormulaAdapter;
  /** Uses the same bounded tree preparation and descendant-leaf summaries as pagination. */
  tree?: TreeTableOptions;
  maxChecks?: number;
  maxIssues?: number;
  signal?: AbortSignal;
}
export interface ReportCandidateValidationOptions extends Pick<ReportDatasetValidationOptions, "rules" | "maxChecks" | "maxIssues"> {
  /** Warnings are visible and allowed by default; block explicitly when required by business policy. */
  warningPolicy?: "allow" | "block";
}
export class ReportValidationError extends Error {
  constructor(public readonly issues: readonly ReportValidationIssue[]) { super(issues.map(issue => issue.message).join("；")); this.name = "ReportValidationError"; }
}
function bound(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`校验 ${name} 超出预算`);
  return value;
}
function checkAggregates(rule: ReportValidationRule): void {
    if (rule.aggregates && rule.scope !== "dataset") throw new Error("仅数据集规则允许汇总");
    if (rule.aggregates && (!Array.isArray(rule.aggregates) || rule.aggregates.length > 64)) throw new Error("校验汇总最多 64 项");
    const outputs = new Set<string>();
    for (const item of rule.aggregates ?? []) {
      computationFieldName(item.field);
      if (outputs.has(item.field)) throw new Error("校验汇总字段重复"); outputs.add(item.field);
      if (item.valueField !== undefined) computationFieldName(item.valueField);
      if (item.weightField !== undefined) computationFieldName(item.weightField);
      aggregateRows([], { ...item, field: item.valueField ?? item.field });
    }
}
export function compileReportValidationRules(rules: readonly ReportValidationRule[]) {
  if (!Array.isArray(rules) || rules.length > 256 || Object.keys(rules).length !== rules.length) throw new Error("校验规则最多 256 条且不允许空位");
  const ids = new Set<string>();
  return rules.map((rule: ReportValidationRule) => {
    if (!rule || typeof rule !== "object") throw new Error("校验规则应为声明式对象");
    computationFieldName(rule.id);
    if (ids.has(rule.id)) throw new Error("校验规则 id 重复"); ids.add(rule.id);
    if (rule.field !== undefined) computationFieldName(rule.field);
    if (rule.dataset !== undefined) computationFieldName(rule.dataset);
    if (typeof rule.message !== "string" || !rule.message.trim() || rule.message.length > 2048) throw new Error("校验规则需要有界提示文案");
    if (rule.severity !== undefined && !["error", "warning"].includes(rule.severity)) throw new Error("未知校验严重程度");
    if (rule.scope !== undefined && !["row", "dataset"].includes(rule.scope)) throw new Error("未知校验范围");
    checkAggregates(rule);
    const budget = { nodes: 0 };
    const assert = compileReportPredicate(rule.assert, budget), when = rule.when ? compileReportPredicate(rule.when, budget) : undefined;
    return { rule, assert, when, checks: budget.nodes };
  });
}
function active(signal?: AbortSignal): void { if (signal?.aborted) { const error = new Error("报表校验已取消"); error.name = "AbortError"; throw error; } }
function issueFor(rule: ReportValidationRule, row: Record<string, unknown>, index: number | undefined, key?: string): ReportValidationIssue {
  const value = key && Object.prototype.hasOwnProperty.call(row, key) ? row[key] : undefined;
  if (value !== undefined && typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) throw new Error("校验定位需要稳定的文本或数值业务键");
  return { ruleId: rule.id, rowIndex: index, ...(value === undefined ? {} : { rowKey: value as string | number }), field: rule.field, severity: rule.severity ?? "error", message: rule.message };
}
function validationRows(input: readonly Record<string, unknown>[], options: ReportDatasetValidationOptions) {
  const computed = options.computed?.length ? { fields: options.computed, formula: options.formula, signal: options.signal } : undefined;
  if (options.tree) {
    const tree = createTreeTable(input, options.tree, { signal: options.signal, computed });
    if (tree.rows.length > 100_000) throw new Error("校验展开后数据最多 100000 行");
    return { rows: tree.rows, summaryRows: tree.leaves, rowKey: options.tree.idField };
  }
  const rows = computed ? computeDataset(input, computed).rows : input;
  return { rows, summaryRows: rows, rowKey: options.rowKey };
}
function checkRows(rows: readonly Record<string, unknown>[], rowKey?: string): void {
  const keys = new Set<string | number>();
  rows.forEach(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("校验数据行应为对象");
    if (!rowKey) return;
    const key = Object.prototype.hasOwnProperty.call(row, rowKey) ? row[rowKey] : undefined;
    if (!(typeof key === "string" && key.trim()) && !(typeof key === "number" && Number.isFinite(key))) throw new Error("校验定位需要稳定业务键");
    if (keys.has(key as string | number)) throw new Error("校验业务键重复"); keys.add(key as string | number);
  });
}
/** Pure candidate validation shared by browsers and Node; checks the complete proposed dataset before persistence. */
export function validateReportDataset(input: readonly Record<string, unknown>[], options: ReportDatasetValidationOptions): ReportValidationIssue[] {
  return validateReportDatasetWithBudget(input, options, { checks: 0 });
}
/** Internal operation-local accounting also covers multiple source parts and expanded tree nodes. */
export function validateReportDatasetWithBudget(input: readonly Record<string, unknown>[], options: ReportDatasetValidationOptions, work: { checks: number }): ReportValidationIssue[] {
  if (!Array.isArray(input) || input.length > 100_000) throw new Error("校验数据最多 100000 行");
  active(options.signal);
  const checks = bound(options.maxChecks ?? 2_000_000, "maxChecks", 10_000_000), maxIssues = bound(options.maxIssues ?? 1000, "maxIssues", 10_000);
  if (options.rowKey !== undefined) computationFieldName(options.rowKey);
  const prepared = validationRows(input, options);
  const { rows, summaryRows, rowKey } = prepared;
  checkRows(rows, rowKey);
  const compiled = compileReportValidationRules(options.rules);
  const cost = compiled.reduce((total, item) => total + (item.rule.scope === "dataset" ? item.checks + summaryRows.length * (item.rule.aggregates?.length ?? 0) : rows.length * item.checks), 0);
  work.checks += cost;
  if (work.checks > checks) throw new Error("整批校验超出 maxChecks 预算");
  const issues: ReportValidationIssue[] = [];
  for (const item of compiled) {
    const candidates = item.rule.scope === "dataset" ? [Object.fromEntries((item.rule.aggregates ?? []).map(aggregate => [aggregate.field, aggregateRows(summaryRows, { ...aggregate, field: aggregate.valueField ?? aggregate.field })]))] : rows;
    candidates.forEach((row, index) => {
      active(options.signal);
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("校验数据行应为对象");
      if (item.when && !item.when(row) || item.assert(row)) return;
      if (issues.length >= maxIssues) throw new Error("校验问题超出 maxIssues 预算，请缩小范围");
      issues.push(issueFor(item.rule, row, item.rule.scope === "dataset" ? undefined : index, item.rule.scope === "dataset" ? undefined : rowKey));
    });
  }
  return issues;
}
export function assertReportValidation(issues: readonly ReportValidationIssue[], warningPolicy: "allow" | "block" = "allow"): void {
  if (!["allow", "block"].includes(warningPolicy)) throw new Error("未知校验警告策略");
  if (!Array.isArray(issues) || issues.length > 10_000 || issues.some(issue => !issue || !["error", "warning"].includes(issue.severity) || typeof issue.ruleId !== "string" || !issue.ruleId.trim() || typeof issue.message !== "string" || !issue.message.trim())) throw new Error("校验问题结构无效");
  if (issues.some(issue => issue.severity === "error" || warningPolicy === "block")) throw new ReportValidationError(issues);
}
