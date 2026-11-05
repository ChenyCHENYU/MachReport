import { computed, ref, watch } from "vue";
import type {
  DatasetContract,
  ListComponent,
  ListColumn,
  ListGroupBy,
  ReportFieldContract,
} from "@agile-team/mach-report";
import type { AggregateDefinition } from "../processing/aggregate";
import type { ComputedField } from "../processing/computed";
import {
  TOTALS_MESSAGES,
  type TemplateTotalsMessages,
} from "./totals-messages";

type SimpleOperation = "sum" | "avg" | "count";
function sourceNumericMode(
  column: ListColumn,
  schema?: ReportFieldContract,
  calculation?: ComputedField,
): AggregateDefinition["numeric"] {
  if (calculation) return calculation.numeric ?? "number";
  if (schema)
    return schema.type === "number" || schema.type === "decimal"
      ? schema.type
      : undefined;
  if (column.valueType === "number" || column.format?.kind === "number")
    return "number";
  return undefined;
}
interface TotalTarget {
  key: string;
  label: string;
  group?: number;
}
export interface TemplateTotalsOptions {
  list: ListComponent;
  schema?: DatasetContract;
  readonly?: boolean;
  messages?: Partial<TemplateTotalsMessages>;
}
function groups(list: ListComponent): ListGroupBy[] {
  return list.groups ?? (list.groupBy ? [list.groupBy] : []);
}
function configuration(list: ListComponent, target: TotalTarget) {
  if (target.group !== undefined) {
    const group = groups(list)[target.group];
    return {
      fields: group?.subtotal ?? [],
      aggregates: group?.aggregates ?? [],
    };
  }
  if (!list.grandTotal) return { fields: [], aggregates: [] };
  const total =
    typeof list.grandTotal === "object" ? list.grandTotal : undefined;
  return {
    fields: total?.fields ?? groups(list)[0]?.subtotal ?? [],
    aggregates: total?.aggregates ?? groups(list)[0]?.aggregates ?? [],
  };
}
function simple(aggregate: AggregateDefinition): boolean {
  return (
    ["sum", "avg", "count"].includes(aggregate.op) &&
    (!aggregate.valueField || aggregate.valueField === aggregate.field) &&
    !aggregate.weightField
  );
}
function assign(
  list: ListComponent,
  target: TotalTarget,
  fields: string[],
  aggregates: AggregateDefinition[],
): void {
  if (target.group !== undefined) {
    const group = groups(list)[target.group]!;
    group.subtotal = fields;
    group.aggregates = aggregates;
  } else if (fields.length || aggregates.length) {
    list.grandTotal = {
      ...(typeof list.grandTotal === "object" ? list.grandTotal : {}),
      fields,
      aggregates,
    };
  } else delete list.grandTotal;
}
/** Edits only explicit simple totals; source data and advanced declarations remain owned by their existing tools. */
export function useTemplateTotals(
  props: TemplateTotalsOptions,
  emit: (list: ListComponent) => void,
) {
  const m = computed(() => ({ ...TOTALS_MESSAGES, ...props.messages }));
  const operation = ref<SimpleOperation>("sum"),
    field = ref(""),
    position = ref("total");
  const complex = computed(
    () =>
      !!(
        props.list.matrix ||
        props.list.tree ||
        props.list.detail ||
        props.list.cardinality === "record"
      ),
  );
  const schemaFields = computed(
    () => new Map(props.schema?.fields.map((item) => [item.field, item])),
  );
  const calculations = computed(
    () => new Map(props.list.computed?.map((item) => [item.field, item])),
  );
  const numericModes = computed(
    () => new Map(props.list.columns.map((column) => [
      column.field,
      sourceNumericMode(column, schemaFields.value.get(column.field), calculations.value.get(column.field)),
    ])),
  );
  const columnLabels = computed(
    () => new Map(props.list.columns.map((column) => [column.field, column.header])),
  );
  const fields = computed(() =>
    props.list.columns.filter((column) => {
      const schema = schemaFields.value.get(column.field);
      if (
        column.hidden ||
        column.field === props.schema?.rowKey ||
        column.field === props.list.rowKey ||
        schema?.aggregation === "none"
      ) return false;
      if (
        ["identifier", "dimension", "date", "text"].includes(
          schema?.semanticRole ?? column.semanticRole ?? "",
        )
      )
        return false;
      return numericModes.value.get(column.field) !== undefined;
    }),
  );
  const targets = computed<TotalTarget[]>(() => [
    { key: "total", label: m.value.tableEnd },
    ...groups(props.list).map((group, index) => ({
      key: `group-${index}`,
      group: index,
      label: `${m.value.groupEnd} · ${columnLabels.value.get(group.field) ?? group.field}`,
    })),
  ]);
  const target = computed(
    () =>
      targets.value.find((item) => item.key === position.value) ??
      targets.value[0]!,
  );
  const entries = computed(() => {
    const config = configuration(props.list, target.value);
    const aggregatesByField = new Map<string, AggregateDefinition[]>();
    for (const aggregate of config.aggregates) {
      const items = aggregatesByField.get(aggregate.field) ?? [];
      items.push(aggregate);
      aggregatesByField.set(aggregate.field, items);
    }
    return [
      ...new Set([
        ...config.fields,
        ...config.aggregates.map((item) => item.field),
      ]),
    ].map((key) => {
      const aggregates = aggregatesByField.get(key) ?? [],
        aggregate = aggregates[0];
      return {
        field: key,
        label:
          columnLabels.value.get(key) ?? key,
        op: aggregate?.op ?? "sum",
        editable: aggregates.length <= 1 && (!aggregate || simple(aggregate)),
      };
    });
  });
  const blocked = computed(() => !!props.readonly || complex.value);
  const canAdd = computed(
    () =>
      !blocked.value &&
      fields.value.some((item) => item.field === field.value) &&
      !entries.value.some(
        (item) => item.field === field.value && !item.editable,
      ),
  );
  const scope = computed(() =>
    target.value.group === undefined ? m.value.scope : m.value.groupScope,
  );
  const configuredCount = computed(() =>
    targets.value.reduce((count, item) => {
      const config = configuration(props.list, item);
      return (
        count +
        new Set([
          ...config.fields,
          ...config.aggregates.map((aggregate) => aggregate.field),
        ]).size
      );
    }, 0),
  );
  const updating = computed(() =>
    entries.value.some((item) => item.field === field.value),
  );
  watch(
    fields,
    (next) => {
      if (!next.some((item) => item.field === field.value))
        field.value = next[0]?.field ?? "";
    },
    { immediate: true },
  );
  watch(targets, (next) => {
    if (!next.some((item) => item.key === position.value))
      position.value = "total";
  });
  function add(): void {
    if (!canAdd.value) return;
    const next: ListComponent = JSON.parse(JSON.stringify(props.list)),
      config = configuration(next, target.value);
    const existing = config.aggregates.find(
      (item) => item.field === field.value,
    );
    const aggregate: AggregateDefinition = {
      ...existing,
      field: field.value,
      op: operation.value,
      numeric: existing?.numeric ?? numericModes.value.get(field.value),
    };
    assign(
      next,
      target.value,
      [...config.fields],
      [
        ...config.aggregates.filter((item) => item.field !== field.value),
        aggregate,
      ],
    );
    emit(next);
  }
  function remove(key: string): void {
    if (
      blocked.value ||
      !entries.value.find((item) => item.field === key)?.editable
    )
      return;
    const next: ListComponent = JSON.parse(JSON.stringify(props.list)),
      config = configuration(next, target.value);
    assign(
      next,
      target.value,
      config.fields.filter((item) => item !== key),
      config.aggregates.filter((item) => item.field !== key),
    );
    emit(next);
  }
  return {
    m,
    operation,
    field,
    position,
    fields,
    targets,
    entries,
    complex,
    blocked,
    canAdd,
    scope,
    configuredCount,
    updating,
    add,
    remove,
  };
}
