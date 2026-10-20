import { computed, ref, watch } from "vue";
import { validateReportParamDefinitions, type ReportParamDef, type ReportTemplateDocument } from "@agile-team/mach-report";
import { PARAM_EDITOR_MESSAGES, type ParamEditorMessages } from "./param-messages";

export interface ParamEditorOptions {
  document: ReportTemplateDocument;
  readonly?: boolean;
  messages?: Partial<ParamEditorMessages>;
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
  options: NonNullable<ReportParamDef["options"]>;
}
export const PARAM_TYPES = ["text", "number", "date", "month", "year", "dateRange", "select"] as const;
export const PARAM_WIRE_FORMAT = { text: "string", number: "string → number", date: "YYYY-MM-DD", month: "YYYY-MM", year: "YYYY", dateRange: "YYYY-MM-DD/YYYY-MM-DD", select: "option.value" };

function cloneDefinitions(defs: readonly ReportParamDef[]): ReportParamDef[] { return JSON.parse(JSON.stringify(defs)) as ReportParamDef[]; }
function toDraft(def: ReportParamDef): ParamDraft {
  return {
    field: def.field, label: def.label ?? "", type: def.type ?? "text", required: def.required === true,
    placeholder: def.placeholder ?? "", defaultEnabled: def.defaultValue !== undefined, defaultValue: def.defaultValue ?? "",
    min: def.min === undefined ? "" : String(def.min), max: def.max === undefined ? "" : String(def.max),
    minLength: def.minLength === undefined ? "" : String(def.minLength), maxLength: def.maxLength === undefined ? "" : String(def.maxLength),
    options: def.options ? def.options.map(option => ({ ...option })) : [],
  };
}
function toDefinition(draft: ParamDraft): ReportParamDef {
  const def: ReportParamDef = { field: draft.field, type: draft.type };
  if (draft.label) def.label = draft.label;
  if (draft.placeholder) def.placeholder = draft.placeholder;
  if (draft.required) def.required = true;
  if (draft.defaultEnabled) def.defaultValue = draft.defaultValue;
  for (const key of ["min", "max"] as const) {
    if (draft[key] !== "") def[key] = draft.type === "number" ? Number(draft[key]) : draft[key];
  }
  for (const key of ["minLength", "maxLength"] as const) if (draft[key] !== "") def[key] = Number(draft[key]);
  if (draft.type === "select") def.options = draft.options.map(option => ({ ...option }));
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
  const current = computed(() => rows.value[selected.value]);
  const currentIssues = computed(() => issues.value.filter(issue => issue.path === `$.paramDefs.${selected.value}`));
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
    current.value.type = type; current.value.min = ""; current.value.max = "";
    current.value.minLength = ""; current.value.maxLength = "";
  }
  function apply(): boolean {
    if (props.readonly || conflicted.value || issues.value.length) return false;
    try {
      if (!props.accept(cloneDefinitions(definitions.value))) { error.value = m.value.paramApplyFailed; return false; }
      baseline.value = JSON.stringify(definitions.value); initialDraft.value = JSON.stringify(rows.value); error.value = "";
      return true;
    } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); return false; }
  }
  return { m, rows, selected, current, definitions, issues, currentIssues, changes, pending, conflicted, error, reset, add, remove, move, setType, apply };
}
