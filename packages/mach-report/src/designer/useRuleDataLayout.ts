import { computed, ref, watch } from "vue";
import { useTemplateToolDraft } from "./useTemplateToolDrafts";
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
import { createTreeTable, type TreeTableOptions } from "../processing/tree";
export interface RuleDataLayoutOptions {
  recoveryKey?: string;
  list: ListComponent;
  accept?: (list: ListComponent) => boolean;
  mode: "detail" | "matrix" | "tree";
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
  const tree = ref<TreeTableOptions>({ input: "flat", idField: "id", parentField: "parentId", labelField: "", parentValues: "source" });
  const localDraft = useLocalDraft(() => ({ enabled: enabled.value, detail: detail.value, matrix: matrix.value, tree: tree.value }));
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
    enabled.value = !!props.list[props.mode];
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
    tree.value = clone(props.list.tree ?? { input: "flat", idField: props.list.rowKey ?? "id", parentField: "parentId", childrenField: "children", labelField: props.list.columns[0]?.field ?? "", parentValues: "source", orphan: "error", indentMm: 3, maxRows: 100000, maxDepth: 64 });
    error.value = "";
    preview.value = undefined;
    localDraft.accept();
  }
  watch(() => [props.mode, props.list.dataset, props.list[props.mode]], reset, { immediate: true });
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
    if (props.readonly) return;
    const current = matrix.value[axis];
    updateMatrixDimensions(axis, checked
      ? [...new Set([...current, field])]
      : current.filter((item) => item !== field));
  }
  function updateMatrixDimensions(axis: "rowFields" | "columnFields", fields: string[]): void {
    const current = matrix.value[axis];
    matrix.value[axis] = fields;
    const config = matrix.value.hierarchy?.[axis === "rowFields" ? "row" : "column"];
    if (config) {
      if (config.sort) config.sort = fields.map(value => config.sort?.[current.indexOf(value)] ?? "source");
      if (config.labels) config.labels = fields.map(value => config.labels?.[current.indexOf(value)] ?? value);
      if (config.subtotals) config.subtotals = config.subtotals.map(depth => fields.indexOf(current[depth - 1]!) + 1).filter(depth => depth > 0 && depth < fields.length);
    }
  }
  function moveDimension(axis: "rowFields" | "columnFields", index: number, direction: -1 | 1): void {
    const fields = [...matrix.value[axis]], target = index + direction;
    if (props.readonly || index < 0 || index >= fields.length || target < 0 || target >= fields.length) return;
    [fields[index], fields[target]] = [fields[target]!, fields[index]!];
    updateMatrixDimensions(axis, fields);
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
  function toggleHierarchy(checked: boolean): void {
    if (props.readonly) return;
    if (!checked) delete matrix.value.hierarchy;
    else matrix.value.hierarchy ??= {};
  }
  function setDimensionSort(axis: "row" | "column", index: number, order: "source" | "asc" | "desc"): void {
    if (props.readonly || !matrix.value.hierarchy) return;
    const config = matrix.value.hierarchy[axis] ??= {};
    const fields = axis === "row" ? matrix.value.rowFields : matrix.value.columnFields;
    const sort = fields.map((_, depth) => config.sort?.[depth] ?? "source");
    sort[index] = order; config.sort = sort;
  }
  function toggleMatrixSubtotal(axis: "row" | "column", depth: number, checked: boolean): void {
    if (props.readonly || !matrix.value.hierarchy) return;
    const config = matrix.value.hierarchy[axis] ??= {};
    config.subtotals = [...new Set(checked ? [...config.subtotals ?? [], depth] : (config.subtotals ?? []).filter(value => value !== depth))];
  }
  function addTreeAggregate(): void { tree.value.aggregates = [...(tree.value.aggregates ?? []), { field: sourceFields.value.find(field => field.field !== tree.value.labelField && field.field !== tree.value.idField)?.field ?? "", op: "sum", numeric: "number" }]; }
  function removeTreeAggregate(index: number): void { tree.value.aggregates = tree.value.aggregates?.filter((_, position) => position !== index); }
  function checkTree(): void {
    error.value = ""; preview.value = undefined;
    try {
      const rows = props.datasets?.[props.list.dataset] ?? [];
      if (!rows.length) throw new Error(props.messages.noData);
      if (rows.length > 1000) throw new Error(props.messages.treeBudget);
      const result = createTreeTable(rows, { ...tree.value, aggregates: tree.value.parentValues === "leaf-aggregate" ? tree.value.aggregates : undefined, maxRows: 1000 });
      const columns = props.list.columns.slice(0, 5);
      preview.value = { columns: columns.map(column => column.header), rows: result.entries.slice(0, 8).map(entry => columns.map(column => column.field === tree.value.labelField ? `${"　".repeat(Math.min(6, entry.depth))}${entry.row[column.field] ?? ""}` : entry.row[column.field])) };
    } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  }
  function applyTree(next: ListComponent): void {
    if (!enabled.value) { delete next.tree; return; }
    next.tree = clone(tree.value);
    if (next.tree.parentValues !== "leaf-aggregate") delete next.tree.aggregates;
    next.rowKey = next.tree.idField;
    delete next.detail; delete next.matrix; delete next.groupBy; delete next.groups; delete next.rowVisibleWhen;
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
    if (props.mode === "tree") applyTree(next);
    else if (props.mode === "detail") {
      if (!enabled.value) delete next.detail;
      else {
        next.detail = clone(detail.value);
        delete next.matrix;
        delete next.tree;
      }
    } else if (!enabled.value) delete next.matrix;
    else {
      next.matrix = clone(matrix.value);
      delete next.detail;
      delete next.tree;
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
  useTemplateToolDraft({ key: () => `${props.recoveryKey ?? "rules:0:0"}:${props.mode}`, baseline: () => JSON.stringify(props.list[props.mode]), pending: () => localDraft.pending.value, snapshot: () => JSON.stringify({ enabled: enabled.value, detail: detail.value, matrix: matrix.value, tree: tree.value, baseline: localDraft.baseline.value }), restore(value) {
    const state = JSON.parse(value) as { enabled: boolean; detail: ListDetail; matrix: MatrixTableOptions; tree: TreeTableOptions; baseline: string };
    enabled.value = state.enabled; detail.value = state.detail; matrix.value = state.matrix; tree.value = state.tree; localDraft.baseline.value = state.baseline;
  } });
  return {
    enabled,
    pendingLocalChanges: localDraft.pending,
    detail,
    matrix,
    tree,
    datasets,
    sourceFields,
    childFields,
    error,
    preview,
    chooseDataset,
    toggleChildColumn,
    toggleDimension,
    moveDimension,
    addMeasure,
    removeMeasure,
    checkMatrix,
    toggleHierarchy,
    setDimensionSort,
    toggleMatrixSubtotal,
    addTreeAggregate,
    removeTreeAggregate,
    checkTree,
    apply,
  };
}
