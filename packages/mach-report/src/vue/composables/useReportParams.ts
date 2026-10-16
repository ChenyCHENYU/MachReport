import { computed, ref, watch, type ComputedRef } from "vue";
import { validateReportParams, type ReportParamDef, type ReportParamIssue } from "@agile-team/mach-report";
import type { MachReportMessages } from "../config";
import { MachReportError } from "../errors";

let panelSequence = 0;
export function createParamPanelId(): string { return `mrp-params-${++panelSequence}`; }

export function paramIssueMessage(issue: ReportParamIssue, defs: readonly ReportParamDef[], messages: MachReportMessages): string {
  const label = (Array.isArray(defs) ? defs.find((def) => def?.field === issue.field)?.label : undefined) ?? issue.field;
  return issue.code === "required" ? messages.paramRequired.replace("{label}", label)
    : (messages.paramInvalid ?? "{label}：{message}").replace("{label}", label).replace("{message}", issue.message);
}

interface ParamHost {
  defs: ComputedRef<ReportParamDef[]>;
  reportIds: ComputedRef<string[]>;
  params(): Record<string, string>;
  messages(): MachReportMessages;
}

/** 参数默认值、清空意图与校验同源；初始必填缺失保持中性，显式查询才展示字段错误。 */
export function useReportParams(host: ParamHost) {
  const values = ref<Record<string, string>>({});
  const attempted = ref(false);
  function reset(): void {
    const next: Record<string, string> = {};
    for (const def of Array.isArray(host.defs.value) ? host.defs.value : []) {
      if (typeof def?.field === "string") Object.defineProperty(next, def.field, { value: host.params()[def.field] ?? def.defaultValue ?? "", writable: true, enumerable: true, configurable: true });
    }
    values.value = next; attempted.value = false;
  }
  reset();
  watch(host.defs, reset);
  watch(host.reportIds, reset);
  watch(() => JSON.stringify(host.params()), reset);
  const validation = computed(() => validateReportParams(host.defs.value, { ...host.params(), ...values.value }));
  const pendingRequired = computed(() => !attempted.value && validation.value.issues.length > 0 && validation.value.issues.every((issue) => issue.code === "required"));
  function query(): { params?: Record<string, string>; error?: MachReportError; quiet: boolean } {
    const result = validation.value;
    if (!result.ok) {
      const issue = result.issues[0]!;
      return { quiet: pendingRequired.value, error: new MachReportError(issue.code === "definition" ? "config" : "param", paramIssueMessage(issue, host.defs.value, host.messages()), { issues: result.issues }) };
    }
    const params = { ...result.values };
    const defaults = new Set(host.defs.value.filter((def) => def.defaultValue !== undefined).map((def) => def.field));
    // 显式清空默认值须传空串，避免下游数据源再次补回默认值；其余可选空项沿用省略契约。
    for (const [field, value] of Object.entries(params)) if (value === "" && !defaults.has(field)) delete params[field];
    return { params, quiet: false };
  }
  return { values, attempted, validation, pendingRequired, reset, query };
}
