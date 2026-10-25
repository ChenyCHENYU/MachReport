import type { ReportParamOptionsLoader } from "../vue/param-options";
import { computed, ref, watch } from "vue";
import { validateReportParamDefinitions, type ReportParamDef, type ReportTemplateDocument } from "@agile-team/mach-report";
import { useTemplateToolDraft } from "./useTemplateToolDrafts";
import { PARAM_EDITOR_MESSAGES, type ParamEditorMessages } from "./param-messages";

export interface ParamEditorOptions {
  document: ReportTemplateDocument;
  readonly?: boolean;
  messages?: Partial<ParamEditorMessages>;
  /** Reuses the same trusted option resolver used by ReportPreview. */
  loadOptions?: ReportParamOptionsLoader;
  /** Return false when the enclosing template transaction rejects the change. */
  accept(definitions: ReportParamDef[]): boolean;
}
export interface ParamDraft {
  field: string;
  label: string;
  type: NonNullable<ReportParamDef["type"]>;
  required: boolean;
  placeholder: string;
  defaultEnabled: boolean;
  defaultValue: string;
  min: string;
  max: string;
  minLength: string;
  maxLength: string;
  minItems: string;
  maxItems: string;
  options: NonNullable<ReportParamDef["options"]>;
  optionsMode: "static" | "remote";
  optionsSource: string;
  dependsOn: string[];
}
export const PARAM_TYPES = ["text", "number", "date", "month", "year", "dateRange", "select", "multiSelect", "cascader", "numberRange"] as const;
export const PARAM_WIRE_FORMAT = { text: "string", number: "string → number", date: "YYYY-MM-DD", month: "YYYY-MM", year: "YYYY", dateRange: "YYYY-MM-DD/YYYY-MM-DD", select: "option.value", multiSelect: 'JSON ["value",…]', cascader: 'JSON ["parent","leaf"]', numberRange: "JSON [minimum,maximum]" };
export type ParamControl = "field" | "type" | "defaultValue" | "min" | "max" | "minLength" | "maxLength" | "options" | "optionsSource" | "dependsOn" | "minItems" | "maxItems";

/** Shared validator messages stay intact; the form adds precise, local control locations. */
function issueControls(message: string): ParamControl[] {
  if (message.startsWith("远程选项")) return ["optionsSource"];
  if (message.startsWith("联动依赖")) return ["dependsOn"];
  if (/^(默认值|必填参数的默认值)/.test(message)) return ["defaultValue"];
  if (message.includes("参数名")) return ["field"];
  if (message.includes("选项")) return ["options"];
  if (message.startsWith("最小边界")) return ["min", "max"];
  if (message.startsWith("最小长度")) return ["minLength", "maxLength"];
  const bound = /^(minLength|maxLength|minItems|maxItems|min|max) /.exec(message)?.[1] as ParamControl | undefined;
  return bound ? [bound] : ["type"];
}

function cloneDefinitions(defs: readonly ReportParamDef[]): ReportParamDef[] { return JSON.parse(JSON.stringify(defs)) as ReportParamDef[]; }
function toDraft(def: ReportParamDef): ParamDraft {
  return {
    field: def.field, label: def.label ?? "", type: def.type ?? "text", required: def.required === true,
    placeholder: def.placeholder ?? "", defaultEnabled: def.defaultValue !== undefined, defaultValue: def.defaultValue ?? "",
    min: def.min === undefined ? "" : String(def.min), max: def.max === undefined ? "" : String(def.max),
    minLength: def.minLength === undefined ? "" : String(def.minLength), maxLength: def.maxLength === undefined ? "" : String(def.maxLength),
    minItems: def.minItems === undefined ? "" : String(def.minItems), maxItems: def.maxItems === undefined ? "" : String(def.maxItems),
    options: def.options ? JSON.parse(JSON.stringify(def.options)) as NonNullable<ReportParamDef["options"]> : [],
    optionsMode: def.optionsSource === undefined ? "static" : "remote", optionsSource: def.optionsSource ?? "", dependsOn: [...def.dependsOn ?? []],
  };
}
function toDefinition(draft: ParamDraft): ReportParamDef {
  const def: ReportParamDef = { field: draft.field, type: draft.type };
  if (draft.label) def.label = draft.label;
  if (draft.placeholder) def.placeholder = draft.placeholder;
  if (draft.required) def.required = true;
  if (draft.defaultEnabled) def.defaultValue = draft.defaultValue;
  for (const key of ["min", "max"] as const) {
    if (draft[key] !== "") def[key] = ["number", "numberRange"].includes(draft.type) ? Number(draft[key]) : draft[key];
  }
  for (const key of ["minLength", "maxLength", "minItems", "maxItems"] as const) if (draft[key] !== "") def[key] = Number(draft[key]);
  if (["select", "multiSelect", "cascader"].includes(draft.type) && draft.optionsMode === "remote") {
    def.optionsSource = draft.optionsSource.trim();
    if (draft.dependsOn.length) def.dependsOn = [...draft.dependsOn];
  } else if (["select", "multiSelect", "cascader"].includes(draft.type)) def.options = JSON.parse(JSON.stringify(draft.options)) as NonNullable<ReportParamDef["options"]>;
  return def;
}

/** Keeps invalid/incomplete form values local until the entire definition array validates. */
export function useParamEditor(props: ParamEditorOptions) {
  const source = () => JSON.stringify(props.document.template.params ?? []);
  const baseline = ref(source());
  const rows = ref((props.document.template.params ?? []).map(toDraft));
  const selected = ref(0);
  const error = ref("");
  const m = computed(() => ({ ...PARAM_EDITOR_MESSAGES, ...props.messages }));
  const definitions = computed(() => rows.value.map(toDefinition));
  const initialDraft = ref(JSON.stringify(rows.value));
  const pending = computed(() => JSON.stringify(rows.value) !== initialDraft.value);
  const conflicted = computed(() => source() !== baseline.value);
  const issues = computed(() => validateReportParamDefinitions(definitions.value));
  const issuesByRow = computed(() => {
    const result = new Map<number, Array<{ message: string; controls: ParamControl[] }>>();
    for (const issue of issues.value) {
      const index = Number(issue.path.split(".").at(-1));
      const entries = result.get(index) ?? [];
      entries.push({ message: issue.message, controls: issueControls(issue.message) });
      result.set(index, entries);
    }
    return result;
  });
  const firstIssueIndex = computed(() => issuesByRow.value.keys().next().value as number | undefined);
  const current = computed(() => rows.value[selected.value]);
  const currentIssues = computed(() => issues.value.filter(issue => issue.path === `$.paramDefs.${selected.value}`));
  function controlIssues(control: ParamControl): string[] {
    return (issuesByRow.value.get(selected.value) ?? []).filter(issue => issue.controls.includes(control)).map(issue => issue.message);
  }
  const changes = computed(() => {
    const before = (JSON.parse(baseline.value) as ReportParamDef[]).map(def => def.field);
    const after = definitions.value.map(def => def.field);
    return { added: after.filter(field => field && !before.includes(field)), removed: before.filter(field => !after.includes(field)) };
  });
  function reset(): void {
    baseline.value = source(); rows.value = (props.document.template.params ?? []).map(toDraft);
    selected.value = Math.min(selected.value, Math.max(0, rows.value.length - 1));
    initialDraft.value = JSON.stringify(rows.value); error.value = "";
  }
  watch(source, () => { if (!pending.value) reset(); });
  function add(): void {
    if (props.readonly) return;
    let index = rows.value.length + 1;
    while (rows.value.some(row => row.field === `param${index}`)) index++;
    rows.value.push(toDraft({ field: `param${index}`, type: "text" })); selected.value = rows.value.length - 1;
  }
  function remove(): void {
    if (props.readonly || !current.value) return;
    rows.value.splice(selected.value, 1); selected.value = Math.min(selected.value, Math.max(0, rows.value.length - 1));
  }
  function move(delta: -1 | 1): void {
    const target = selected.value + delta;
    if (props.readonly || target < 0 || target >= rows.value.length) return;
    const row = rows.value.splice(selected.value, 1)[0]!; rows.value.splice(target, 0, row); selected.value = target;
  }
  function setType(type: ParamDraft["type"]): void {
    if (props.readonly || !current.value) return;
    if (current.value.type === "cascader" && type !== "cascader") current.value.options = current.value.options.map(option => ({ label: option.label, value: option.value }));
    current.value.type = type; current.value.min = ""; current.value.max = "";
    current.value.minLength = ""; current.value.maxLength = ""; current.value.minItems = ""; current.value.maxItems = "";
  }
  function apply(): boolean {
    if (props.readonly || conflicted.value || issues.value.length) return false;
    try {
      if (!props.accept(cloneDefinitions(definitions.value))) { error.value = m.value.paramApplyFailed; return false; }
      baseline.value = JSON.stringify(definitions.value); initialDraft.value = JSON.stringify(rows.value); error.value = "";
      return true;
    } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); return false; }
  }
  useTemplateToolDraft({ key: () => "params", baseline: () => baseline.value, pending: () => pending.value, snapshot: () => JSON.stringify({ rows: rows.value, selected: selected.value, initial: initialDraft.value }), restore(value, source) {
    const state = JSON.parse(value) as { rows: ParamDraft[]; selected: number; initial: string };
    if (!Array.isArray(state.rows) || state.rows.length > 1000 || typeof state.initial !== "string") throw new Error("Invalid parameter draft");
    rows.value = state.rows.map(row => ({ ...row, minItems: row.minItems ?? "", maxItems: row.maxItems ?? "", optionsMode: row.optionsMode ?? "static", optionsSource: row.optionsSource ?? "", dependsOn: row.dependsOn ?? [] })); selected.value = Math.max(0, Math.min(state.selected, state.rows.length - 1)); initialDraft.value = state.initial; baseline.value = source;
  } });
  return { m, rows, selected, current, definitions, issues, issuesByRow, firstIssueIndex, controlIssues, currentIssues, changes, pending, conflicted, error, reset, add, remove, move, setType, apply };
}
