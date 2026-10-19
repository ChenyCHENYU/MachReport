import type { ReportTemplate } from "../layout/paginate";

export interface TemplateBindingReference { field: string; path: string; summary?: boolean }
export interface TemplateDatasetBinding { dataset: string; path: string; fields: TemplateBindingReference[]; generated: Set<string>; summaries: Set<string> }
type ObjectValue = Record<string, unknown>;
function object(value: unknown): value is ObjectValue { return !!value && typeof value === "object" && !Array.isArray(value); }
function fields(value: unknown, path: string, target: TemplateBindingReference[]): void {
  if (typeof value === "string") target.push({ field: value, path });
  else if (Array.isArray(value)) value.forEach((field, index) => fields(field, `${path}[${index}]`, target));
}
function expression(value: unknown, path: string, target: TemplateBindingReference[]): void {
  if (Array.isArray(value)) { value.forEach((item, index) => expression(item, `${path}[${index}]`, target)); return; }
  if (!object(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (["field", "weightField"].includes(key)) fields(child, `${path}.${key}`, target);
    else if (key !== "value" && key !== "style") expression(child, `${path}.${key}`, target);
  }
}
function aggregates(value: unknown, path: string, target: TemplateDatasetBinding): void {
  if (!Array.isArray(value)) return;
  value.forEach((aggregate, index) => {
    if (!object(aggregate)) return;
    if (typeof aggregate.field === "string" && aggregate.valueField !== undefined && aggregate.valueField !== aggregate.field) target.summaries.add(aggregate.field);
    fields(aggregate.valueField ?? aggregate.field, `${path}[${index}].valueField`, target.fields);
    fields(aggregate.weightField, `${path}[${index}].weightField`, target.fields);
  });
}
function listReferences(item: ObjectValue, path: string, binding: TemplateDatasetBinding): void {
  for (const key of ["rowKey", "revisionField", "sourceTokenField"]) fields(item[key], `${path}.${key}`, binding.fields);
  if (!item.matrix && Array.isArray(item.columns)) item.columns.forEach((column, index) => {
    if (!object(column)) return;
    if (typeof column.field === "string") binding.fields.push({ field: column.field, path: `${path}.columns[${index}].field`, summary: true });
    expression(column.rules, `${path}.columns[${index}].rules`, binding.fields);
    expression(column.visibleWhen, `${path}.columns[${index}].visibleWhen`, binding.fields);
  });
  expression(item.rowVisibleWhen, `${path}.rowVisibleWhen`, binding.fields);
  if (Array.isArray(item.computed)) item.computed.forEach((computed, index) => {
    if (!object(computed)) return;
    if (typeof computed.field === "string") binding.generated.add(computed.field);
    expression(computed.expression, `${path}.computed[${index}].expression`, binding.fields);
    fields(computed.dependsOn, `${path}.computed[${index}].dependsOn`, binding.fields);
    fields(computed.groupBy, `${path}.computed[${index}].groupBy`, binding.fields);
  });
  const groups = Array.isArray(item.groups) ? item.groups : item.groupBy ? [item.groupBy] : [];
  groups.forEach((group, index) => {
    if (!object(group)) return;
    fields(group.field, `${path}.groups[${index}].field`, binding.fields);
    fields(group.subtotal, `${path}.groups[${index}].subtotal`, binding.fields);
    aggregates(group.aggregates, `${path}.groups[${index}].aggregates`, binding);
  });
  if (object(item.grandTotal)) {
    fields(item.grandTotal.fields, `${path}.grandTotal.fields`, binding.fields);
    aggregates(item.grandTotal.aggregates, `${path}.grandTotal.aggregates`, binding);
  }
  if (object(item.matrix)) {
    fields(item.matrix.rowFields, `${path}.matrix.rowFields`, binding.fields);
    fields(item.matrix.columnFields, `${path}.matrix.columnFields`, binding.fields);
    aggregates(item.matrix.measures, `${path}.matrix.measures`, binding);
  }
  if (object(item.detail)) fields(item.detail.parentKey, `${path}.detail.parentKey`, binding.fields);
}

/** Required source references include formulas/conditions/relations, not just displayed columns. */
export function collectTemplateDatasetBindings(template: ReportTemplate): TemplateDatasetBinding[] {
  const result: TemplateDatasetBinding[] = [];
  function visit(value: unknown, path: string): void {
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${path}[${index}]`)); return; }
    if (!object(value)) return;
    if (typeof value.dataset === "string" && Array.isArray(value.columns)) {
      const binding: TemplateDatasetBinding = { dataset: value.dataset, path, fields: [], generated: new Set(), summaries: new Set() };
      listReferences(value, path, binding);
      if (typeof value.foreignKey === "string") fields(value.foreignKey, `${path}.foreignKey`, binding.fields);
      result.push(binding);
    }
    for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
  }
  visit(template, "$.template"); return result;
}
