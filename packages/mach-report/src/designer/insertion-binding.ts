import {
  columnsFromContract,
  type DatasetContract,
  type ListColumn,
  type ReportChartBinding,
} from "@agile-team/mach-report";

export function insertionColumn(field: DatasetContract["fields"][number], widthMm: number): ListColumn {
  return {
    ...columnsFromContract({ fields: [field] })[0]!,
    widthMm,
    valueType: field.type === "number" ? "number" : field.type === "boolean" ? "boolean" : "text",
  };
}

/** Bind actual declared fields. A dataset with no measure can show record counts. */
export function insertionChart(schema: DatasetContract, dataset: string, countLabel: string): ReportChartBinding | undefined {
  const fields = schema.fields.filter(field => field.field !== schema.rowKey);
  const category = fields.find(field => field.semanticRole === "dimension")
    ?? fields.find(field => field.type === "text" || field.type === "date")
    ?? fields[0];
  if (!category) return;
  const measure = fields.find(field => (field.type === "number" || field.type === "decimal")
    && field.semanticRole !== "identifier" && field.aggregation !== "none");
  return {
    dataset,
    categoryField: category.field,
    type: "bar",
    measures: [measure
      ? { op: "sum", field: measure.field, numeric: measure.type === "decimal" ? "decimal" : "number", label: measure.label || measure.field }
      : { op: "count", label: countLabel }],
  };
}
