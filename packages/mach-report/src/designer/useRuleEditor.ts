import { computed, ref, watch } from "vue";
import type {
  ListComponent,
  ListGroupBy,
  DatasetRows,
} from "../layout/paginate";
import type { DatasetContract } from "../schema/dataset";
import {
  computeDataset,
  validateComputedFields,
  type ComputedField,
  type ReportExpression,
} from "../analytics/computed";
import type { StyleRule } from "../format";
import { validateReportTemplate } from "../source/template-registry";
import {
  DEFAULT_RULE_EDITOR_MESSAGES,
  type RuleEditorMessages,
} from "./rule-messages";
export interface RuleEditorOptions {
  list: ListComponent;
  datasets?: DatasetRows;
  datasetSchema?: DatasetContract;
  datasetSchemas?: Record<string, DatasetContract>;
  readonly?: boolean;
  messages?: Partial<RuleEditorMessages>;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function useRuleEditor(
  props: RuleEditorOptions,
  change: (list: ListComponent) => void,
) {
  const m = computed(() => ({
    ...DEFAULT_RULE_EDITOR_MESSAGES,
    ...props.messages,
  }));
  const tab = ref<
      "computations" | "groups" | "conditions" | "detail" | "matrix"
    >("computations"),
    error = ref("");
  const selectedComputed = ref(""),
    formula = ref<ComputedField>({
      field: "",
      expression: { field: "" },
      scope: "row",
    });
  const groups = ref<ListGroupBy[]>([]),
    groupIndex = ref(0);
  const column = ref(""),
    conditionIndex = ref(-1),
    effect = ref<"style" | "cell" | "rowVisibility">("style");
  const when = ref<StyleRule["when"]>({ field: "", op: ">", value: 0 });
  const style = ref({
    color: "#b91c1c",
    backgroundColor: "#fff1f2",
    bold: false,
  });
  const preview = ref<Array<{ row: number; value: unknown }>>([]);
  const fields = computed(() => {
    const map = new Map<string, string>();
    for (const field of props.datasetSchema?.fields ?? [])
      map.set(field.field, field.label ?? field.field);
    for (const item of props.list.columns)
      if (!map.has(item.field)) map.set(item.field, item.header || item.field);
    for (const key of Object.keys(
      props.datasets?.[props.list.dataset]?.[0] ?? {},
    ))
      if (!map.has(key)) map.set(key, key);
    return [...map].map(([field, label]) => ({ field, label }));
  });
  const currentGroup = computed(() => groups.value[groupIndex.value]);
  const currentColumn = computed(() =>
    props.list.columns.find((item) => item.field === column.value),
  );
  const diagnostics = computed(() => validateComputedFields(candidateFields()));
  function reset(): void {
    groups.value = clone(
      props.list.groups ?? (props.list.groupBy ? [props.list.groupBy] : []),
    );
    for (const group of groups.value) for (const aggregate of group.aggregates ?? []) aggregate.numeric ??= "number";
    if (!props.list.columns.some((item) => item.field === column.value))
      column.value = props.list.columns[0]?.field ?? "";
    error.value = "";
    preview.value = [];
    loadComputed(selectedComputed.value);
    loadCondition(-1);
  }
  watch(() => props.list, reset, { immediate: true });
  function loadComputed(field: string): void {
    selectedComputed.value = field;
    formula.value = clone(
      props.list.computed?.find((item) => item.field === field) ?? {
        field: "",
        expression: { field: fields.value[0]?.field ?? "" },
        scope: "row",
      },
    );
    formula.value.numeric ??= "number";
    preview.value = [];
    error.value = "";
  }
  function candidateFields(): ComputedField[] {
    const current = props.list.computed ?? [];
    return [
      ...current.filter((item) => item.field !== selectedComputed.value),
      clone(formula.value),
    ];
  }
  function commit(next: ListComponent): boolean {
    if (props.readonly) return false;
    const validation = validateReportTemplate({
      pages: [
        {
          widthMm: Math.max(1, next.leftMm + next.widthMm),
          heightMm: 297,
          components: [next],
        },
      ],
    });
    if (!validation.ok) {
      error.value = validation.errors
        .map((item) => item.message)
        .slice(0, 3)
        .join("；");
      return false;
    }
    error.value = "";
    change(next);
    return true;
  }
  function applyComputed(): void {
    if (!formula.value.field.trim()) {
      error.value = m.value.missingTarget;
      return;
    }
    const next = clone(props.list);
    next.computed = candidateFields();
    if (!next.columns.some((item) => item.field === formula.value.field))
      next.columns.push({
        field: formula.value.field,
        header: formula.value.field,
        widthMm: 30,
        semanticRole: "measure",
        align: "right",
        editable: false,
        format: {
          kind: "number",
          ...(formula.value.digits === undefined
            ? {}
            : { digits: formula.value.digits }),
        },
      });
    if (commit(next)) selectedComputed.value = formula.value.field;
  }
  function removeComputed(): void {
    if (!selectedComputed.value) return;
    const next = clone(props.list);
    next.computed = (next.computed ?? []).filter(
      (item) => item.field !== selectedComputed.value,
    );
    if (commit(next)) loadComputed("");
  }
  function check(): void {
    preview.value = [];
    error.value = "";
    const input = props.datasets?.[props.list.dataset];
    if (!input?.length) {
      error.value = m.value.noData;
      return;
    }
    try {
      const result = computeDataset(input.slice(0, 1000), {
        fields: candidateFields(),
        maxRows: 1000,
        maxCells: 2_000_000,
      });
      preview.value = result.rows
        .slice(0, 5)
        .map((row, index) => ({
          row: index + 1,
          value: row[formula.value.field],
        }));
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  function setExpression(value: ReportExpression): void {
    formula.value.expression = value;
  }
  function toggleGroupField(field: string, checked: boolean): void {
    formula.value.groupBy = checked
      ? [...(formula.value.groupBy ?? []), field]
      : (formula.value.groupBy ?? []).filter((item) => item !== field);
  }
  function addGroup(): void {
    groups.value.push({
      field: fields.value[0]?.field ?? "",
      headerTemplate: "{value}",
      subtotalLabel: m.value.subtotalLabel,
      aggregates: [],
      keepWithNext: true,
    });
    groupIndex.value = groups.value.length - 1;
  }
  function moveGroup(direction: number): void {
    const index = groupIndex.value,
      target = index + direction;
    if (target < 0 || target >= groups.value.length) return;
    [groups.value[index], groups.value[target]] = [
      groups.value[target]!,
      groups.value[index]!,
    ];
    groupIndex.value = target;
  }
  function removeGroup(): void {
    groups.value.splice(groupIndex.value, 1);
    groupIndex.value = Math.max(
      0,
      Math.min(groupIndex.value, groups.value.length - 1),
    );
  }
  function addAggregate(): void {
    if (!currentGroup.value) return;
    (currentGroup.value.aggregates ??= []).push({
      field: fields.value[0]?.field ?? "",
      op: "sum",
      numeric: "number",
    });
  }
  function applyGroups(): void {
    const next = clone(props.list);
    next.groups = clone(groups.value);
    delete next.groupBy;
    commit(next);
  }
  function loadCondition(index: number): void {
    conditionIndex.value = index;
    const condition =
      effect.value === "cell"
        ? currentColumn.value?.visibleWhen
        : effect.value === "rowVisibility"
          ? props.list.rowVisibleWhen
          : currentColumn.value?.rules?.[index]?.when;
    when.value = clone(condition ?? { field: column.value, op: ">", value: 0 });
    const existing = currentColumn.value?.rules?.[index]?.style;
    style.value = {
      color: String(existing?.color ?? "#b91c1c"),
      backgroundColor: String(existing?.backgroundColor ?? "#fff1f2"),
      bold: existing?.bold === true,
    };
  }
  function setThreshold(value: string): void {
    const contract = props.datasetSchema?.fields.find(
      (field) => field.field === when.value.field,
    );
    const data = props.datasets?.[props.list.dataset]?.find(
      (row) => row[when.value.field] != null,
    )?.[when.value.field];
    const numeric =
      contract?.type === "number" || (!contract && typeof data === "number");
    if (contract?.type === "decimal") when.value.numeric = "decimal";
    else if (numeric) when.value.numeric = "number";
    else delete when.value.numeric;
    when.value.value =
      numeric && value.trim() && Number.isFinite(Number(value))
        ? Number(value)
        : value;
  }
  function applyCondition(remove = false): void {
    const next = clone(props.list),
      target = next.columns.find((item) => item.field === column.value);
    if (!target) {
      error.value = m.value.noSelection;
      return;
    }
    if (effect.value === "rowVisibility") {
      if (remove) delete next.rowVisibleWhen;
      else next.rowVisibleWhen = clone(when.value);
    } else if (effect.value === "cell") {
      if (remove) delete target.visibleWhen;
      else target.visibleWhen = clone(when.value);
    } else {
      target.rules ??= [];
      if (remove && conditionIndex.value >= 0)
        target.rules.splice(conditionIndex.value, 1);
      else if (remove) return;
      else if (conditionIndex.value < 0)
        target.rules.push({
          when: clone(when.value),
          style: { ...style.value },
        });
      else
        target.rules[conditionIndex.value] = {
          when: clone(when.value),
          style: { ...style.value },
        };
    }
    commit(next);
  }
  return {
    m,
    tab,
    fields,
    formula,
    groups,
    groupIndex,
    currentGroup,
    column,
    currentColumn,
    conditionIndex,
    effect,
    when,
    style,
    error,
    preview,
    diagnostics,
    selectedComputed,
    loadComputed,
    applyComputed,
    removeComputed,
    check,
    setExpression,
    toggleGroupField,
    addGroup,
    moveGroup,
    removeGroup,
    addAggregate,
    applyGroups,
    loadCondition,
    setThreshold,
    applyCondition,
    applyLayout: commit,
  };
}
