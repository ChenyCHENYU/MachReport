import type { TreeTableOptions } from "../processing/tree";
import type { ReportEditSessionPart } from "./session-data";
import { validateReportDatasetWithBudget, compileReportValidationRules, type ReportCandidateValidationOptions, type ReportValidationIssue } from "./validation";
import type { FormulaAdapter, ComputedField } from "../processing/computed";
interface ValidationBinding { rowKey?: string; computed?: ComputedField[]; tree?: TreeTableOptions }
function setBinding(bindings: Map<string, ValidationBinding>, dataset: string, next: ValidationBinding): void {
  const previous = bindings.get(dataset);
  if (previous && JSON.stringify(previous) !== JSON.stringify(next)) throw new Error("同一数据集的校验计算/业务键存在歧义，请统一绑定");
  bindings.set(dataset, next);
}
/** Validate source candidates (including hidden rows) rather than the paginated display. */
export function validateSessionCandidates(parts: readonly ReportEditSessionPart[], options: ReportCandidateValidationOptions, signal?: AbortSignal, formulas: readonly (FormulaAdapter | undefined)[] = []): ReportValidationIssue[] {
  compileReportValidationRules(options.rules);
  const issues: ReportValidationIssue[] = [];
  const work = { checks: 0 };
  for (const [partIndex, part] of parts.entries()) {
    const bindings = new Map<string, ValidationBinding>();
    for (const page of part.template.pages) for (const list of page.components) {
      if (list.kind !== "list") continue;
      setBinding(bindings, list.dataset, { rowKey: list.tree?.idField ?? list.rowKey, computed: list.computed, tree: list.tree });
      if (list.detail) setBinding(bindings, list.detail.dataset, { rowKey: list.detail.rowKey });
    }
    for (const [dataset, binding] of bindings) {
      const rules = options.rules.filter(rule => !rule.dataset || rule.dataset === dataset);
      if (!rules.length) continue;
      issues.push(...validateReportDatasetWithBudget(part.datasets[dataset] ?? [], { ...options, rules, ...binding, formula: formulas[partIndex], signal }, work).map(issue => ({ ...issue, dataset, sourceScope: part.sourceScope })));
      if (issues.length > (options.maxIssues ?? 1000)) throw new Error("整批候选校验问题超出 maxIssues 预算");
    }
  }
  const targets = new Set(parts.flatMap(part => part.template.pages.flatMap(page => page.components.flatMap(list => list.kind === "list" ? [list.dataset, ...(list.detail ? [list.detail.dataset] : [])] : []))));
  if (options.rules.some(rule => rule.dataset && !targets.has(rule.dataset))) throw new Error("校验目标数据集不存在");
  return issues;
}
