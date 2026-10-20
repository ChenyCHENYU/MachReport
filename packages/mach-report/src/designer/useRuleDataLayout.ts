import { computed, ref, watch } from "vue";
import { useLocalDraft } from "./useLocalDraft";
import type {
  DatasetRows,
  ListComponent,
  ListDetail,
} from "../layout/paginate";
import type { DatasetContract } from "../schema/dataset";
import {
  createMatrixTable,
  type MatrixTableOptions,
} from "../processing/matrix";
import { validateReportTemplate } from "../source/template-registry";
import type { RuleEditorMessages } from "./rule-messages";
export interface RuleDataLayoutOptions {
  list: ListComponent;
  accept?: (list: ListComponent) => boolean;
  mode: "detail" | "matrix";
  datasets?: DatasetRows;
  datasetSchema?: DatasetContract;
  datasetSchemas?: Record<string, DatasetContract>;
  readonly?: boolean;
  messages: RuleEditorMessages;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function useRuleDataLayout(
  props: RuleDataLayoutOptions,
  change: (list: ListComponent) => void,
) {
  const enabled = ref(false),
    error = ref("");
  const detail = ref<ListDetail>({
    dataset: "",
    parentKey: "",
    foreignKey: "",
    columns: [],
  });
  const matrix = ref<MatrixTableOptions>({
    rowFields: [],
    columnFields: [],
    measures: [],
  });
  const localDraft = useLocalDraft(() => ({ enabled: enabled.value, detail: detail.value, matrix: matrix.value }));
  let committed: string | undefined;
  const preview = ref<{ columns: string[]; rows: unknown[][] }>();
  const datasets = computed(() => [
    ...new Set([
      ...Object.keys(props.datasets ?? {}),
      ...Object.keys(props.datasetSchemas ?? {}),
    ]),
  ]);
  const sourceFields = computed(() =>
    fieldChoices(props.list.dataset, props.datasetSchema),
  );
  const childFields = computed(() => fieldChoices(detail.value.dataset));
  function fieldChoices(dataset: string, override?: DatasetContract) {
    const map = new Map<string, string>();
    for (const field of (override ?? props.datasetSchemas?.[dataset])?.fields ??
      [])
      map.set(field.field, field.label ?? field.field);
    const row = props.datasets?.[dataset]?.[0];
    for (const field of Object.keys(row ?? {}))
      if (!map.has(field)) map.set(field, field);
    if (dataset === props.list.dataset)
      for (const column of props.list.columns)
        if (!map.has(column.field))
          map.set(column.field, column.header || column.field);
    return [...map].map(([field, label]) => ({ field, label }));
  }
  function reset(): void {
    if (committed === JSON.stringify(props.list)) { committed = undefined; return; }
    enabled.value =
      props.mode === "detail" ? !!props.list.detail : !!props.list.matrix;
    const first =
      datasets.value.find((item) => item !== props.list.dataset) ?? "";
    detail.value = clone(
      props.list.detail ?? {
        dataset: first,
        parentKey:
          props.list.rowKey ??
          props.datasetSchema?.rowKey ??
          sourceFields.value[0]?.field ??
          "",
        foreignKey: "",
        columns: [],
        header: true,
        unmatched: "error",
      },
    );
    matrix.value = clone(
      props.list.matrix ?? {
        rowFields: [],
        columnFields: [],
        measures: [],
        totals: true,
      },
    );
    matrix.value.measures = matrix.value.measures.map((measure) => ({ ...measure, numeric: measure.numeric ?? "number" }));
    error.value = "";
    preview.value = undefined;
    localDraft.accept();
  }
  watch(() => [props.mode, props.list.dataset, props.mode === "detail" ? props.list.detail : props.list.matrix], reset, { immediate: true });
  function chooseDataset(dataset: string): void {
    detail.value.dataset = dataset;
    detail.value.columns = [];
    detail.value.foreignKey = childFields.value[0]?.field ?? "";
    detail.value.rowKey = props.datasetSchemas?.[dataset]?.rowKey;
  }
  function toggleChildColumn(field: string, checked: boolean): void {
    if (
      checked &&
      !detail.value.columns.some((column) => column.field === field)
    ) {
      const contract = props.datasetSchemas?.[
        detail.value.dataset
      ]?.fields.find((item) => item.field === field);
      detail.value.columns.push({
        field,
        header:
          childFields.value.find((item) => item.field === field)?.label ??
          field,
        widthMm: 30,
        align: "auto",
        semanticRole: contract?.semanticRole,
        editable: false,
      });
    } else if (!checked)
      detail.value.columns = detail.value.columns.filter(
        (column) => column.field !== field,
      );
  }
  function toggleDimension(
    axis: "rowFields" | "columnFields",
    field: string,
    checked: boolean,
  ): void {
    const current = matrix.value[axis];
    matrix.value[axis] = checked
      ? [...new Set([...current, field])]
      : current.filter((item) => item !== field);
  }
  function addMeasure(): void {
    matrix.value.measures = [
      ...matrix.value.measures,
      { field: sourceFields.value[0]?.field ?? "", op: "sum", numeric: "number" },
    ];
  }
  function removeMeasure(index: number): void {
    matrix.value.measures = matrix.value.measures.filter(
      (_, position) => position !== index,
    );
  }
  function checkMatrix(): void {
    error.value = "";
    preview.value = undefined;
    try {
      const rows = props.datasets?.[props.list.dataset] ?? [];
      if (!rows.length) throw new Error(props.messages.noData);
      const result = createMatrixTable(rows.slice(0, 1000), {
        ...matrix.value,
        maxInputRows: 1000,
      });
      preview.value = {
        columns: result.columns.slice(0, 5).map((item) => item.header),
        rows: result.rows
          .slice(0, 5)
          .map((row) =>
            result.columns.slice(0, 5).map((column) => row[column.field]),
          ),
      };
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  function apply(): void {
    if (props.readonly) return;
    const next = clone(props.list);
    if (props.mode === "detail") {
      if (!enabled.value) delete next.detail;
      else {
        next.detail = clone(detail.value);
        delete next.matrix;
      }
    } else if (!enabled.value) delete next.matrix;
    else {
      next.matrix = clone(matrix.value);
      delete next.detail;
      delete next.groups;
      delete next.groupBy;
      delete next.grandTotal;
    }
    const result = validateReportTemplate({ pages: [{ widthMm: Math.max(1, next.leftMm + next.widthMm), heightMm: 297, components: [next] }] });
    if (!result.ok) { error.value = result.errors.slice(0, 3).map(issue => issue.message).join("；"); return; }
    if (props.accept && !props.accept(next)) return;
    committed = JSON.stringify(next);
    if (!props.accept) change(next);
    localDraft.accept();
  }
  return {
    enabled,
    pendingLocalChanges: localDraft.pending,
    detail,
    matrix,
    datasets,
    sourceFields,
    childFields,
    error,
    preview,
    chooseDataset,
    toggleChildColumn,
    toggleDimension,
    addMeasure,
    removeMeasure,
    checkMatrix,
    apply,
  };
}
