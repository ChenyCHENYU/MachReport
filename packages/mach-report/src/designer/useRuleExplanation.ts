import { computed, ref, type Ref } from "vue";
import type { ComputedField, ReportExpression } from "../processing/computed";
import type { RuleEditorOptions } from "./useRuleEditor";
import type { RuleEditorMessages } from "./rule-messages";
function references(expression: ReportExpression | string, result = new Set<string>()): Set<string> {
  if (typeof expression === "string") return result;
  if ("field" in expression && expression.field) result.add(expression.field);
  if ("weightField" in expression && expression.weightField) result.add(expression.weightField);
  if ("args" in expression) expression.args.forEach((item) => references(item, result));
  return result;
}
function describe(expression: ReportExpression | string, m: RuleEditorMessages): string {
  if (typeof expression === "string") return expression;
  if ("value" in expression) return expression.value === null ? m.null : String(expression.value);
  if ("aggregate" in expression) return `${m[expression.aggregate]}(${expression.field ?? m.allRows})`;
  if ("field" in expression) return expression.field;
  return `${m[expression.op]}(${expression.args.map((item) => describe(item, m)).join(", ")})`;
}
/** Explanation uses the same engine result; it never substitutes a separate arithmetic evaluator. */
export function useRuleExplanation(props: RuleEditorOptions, formula: Ref<ComputedField>, m: Readonly<Ref<RuleEditorMessages>>) {
  const query = ref("");
  function digits(field: string): string | undefined {
    const format = props.list.columns.find(column => column.field === field)?.format;
    return format && "digits" in format && format.digits !== undefined ? `${format.digits} ${m.value.digits}` : undefined;
  }
  const allFields = computed(() => {
    const map = new Map<string, { field: string; label: string; meta: string }>();
    for (const item of props.datasetSchema?.fields ?? []) map.set(item.field, { field: item.field, label: item.label ?? item.field,
      meta: [item.type, item.unit, digits(item.field)].filter(Boolean).join(" · ") });
    for (const item of props.list.columns) if (!map.has(item.field)) map.set(item.field, { field: item.field, label: item.header || item.field, meta: item.semanticRole ?? "" });
    return [...map.values()];
  });
  const matches = computed(() => {
    const term = query.value.trim().toLocaleLowerCase();
    return allFields.value.filter((item) => `${item.field} ${item.label} ${item.meta}`.toLocaleLowerCase().includes(term));
  });
  const expression = computed(() => describe(formula.value.expression, m.value));
  const sources = computed(() => {
    const fields = [...references(formula.value.expression)];
    return (props.datasets?.[props.list.dataset] ?? []).slice(0, 5).map((row, index) => ({ row: index + 1,
      values: fields.map((field) => `${field} = ${row[field] == null ? m.value.null : String(row[field])}`).join(" · ") }));
  });
  return { query, matches, fieldWindow: computed(() => matches.value.slice(0, 50)), expression, sources };
}
