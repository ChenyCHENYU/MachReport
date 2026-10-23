/** Persistence is untrusted. Validate form structure before reactive tools consume it. */
type RecordValue = Record<string, unknown>;
function object(value: unknown): value is RecordValue { return !!value && typeof value === "object" && !Array.isArray(value); }
function strings(value: RecordValue, fields: string[]): boolean { return fields.every(field => typeof value[field] === "string"); }
function array(value: unknown): value is unknown[] { return Array.isArray(value) && value.length <= 10000; }
function expression(value: unknown, depth = 0): boolean {
  if (!object(value) || depth > 16) return false;
  if ("op" in value) return typeof value.op === "string" && array(value.args) && value.args.every(item => expression(item, depth + 1));
  if ("field" in value) return typeof value.field === "string";
  if ("aggregate" in value) return typeof value.aggregate === "string";
  return "value" in value && (value.value === null || ["string", "number", "boolean"].includes(typeof value.value));
}
function formula(value: unknown): boolean { return object(value) && typeof value.field === "string" && expression(value.expression); }
function stringArray(value: unknown): boolean { return array(value) && value.every(item => typeof item === "string"); }
function matrix(value: unknown): boolean { return object(value) && stringArray(value.rowFields) && stringArray(value.columnFields) && array(value.measures) && value.measures.every(item => object(item) && typeof item.op === "string"); }
function tableRecipe(value: unknown): boolean { return object(value) && strings(value, ["sheet", "dataset", "rowKey"]) && stringArray(value.fields) && object(value.regions); }
function regionRecipe(value: unknown): boolean { return object(value) && typeof value.sheet === "string" && array(value.regions) && value.regions.every(region => object(region) && strings(region, ["id", "range", "dataset", "mode", "rowKey"]) && stringArray(region.fields)); }
function pairs(value: unknown, check: (item: unknown) => boolean): boolean { return array(value) && value.every(item => Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && check(item[1])); }
function params(value: RecordValue): boolean {
  return typeof value.initial === "string" && Number.isSafeInteger(value.selected) && array(value.rows) && value.rows.every(paramRow);
}
function paramRow(row: unknown): boolean {
  return object(row) && strings(row, ["field", "label", "type", "placeholder", "defaultValue", "min", "max", "minLength", "maxLength"]) && typeof row.required === "boolean" && typeof row.defaultEnabled === "boolean"
    && (row.optionsMode === undefined || row.optionsMode === "static" || row.optionsMode === "remote") && (row.optionsSource === undefined || typeof row.optionsSource === "string") && (row.dependsOn === undefined || stringArray(row.dependsOn))
    && array(row.options) && row.options.every(option => object(option) && strings(option, ["label", "value"]));
}
function rules(value: RecordValue): boolean {
  return formula(value.formula) && array(value.groups) && value.groups.every(group => object(group) && typeof group.field === "string") && object(value.when) && object(value.style) && strings(value, ["selectedComputed", "column", "conditionKey", "effect", "tab", "formulaBaseline", "groupBaseline", "conditionBaseline"]) && Number.isSafeInteger(value.conditionIndex) && pairs(value.computedDrafts, formula) && pairs(value.conditionDrafts, item => object(item) && object(item.when) && object(item.style));
}
function layout(value: RecordValue): boolean {
  return typeof value.enabled === "boolean" && typeof value.baseline === "string" && object(value.detail) && strings(value.detail, ["dataset", "parentKey", "foreignKey"]) && array(value.detail.columns) && value.detail.columns.every(column => object(column) && strings(column, ["field", "header"])) && matrix(value.matrix) && object(value.tree) && typeof value.tree.input === "string";
}
function excel(value: RecordValue): boolean {
  return tableRecipe(value.recipe) && regionRecipe(value.regions) && object(value.identity) && strings(value.identity, ["id", "name"]) && object(value.cached) && array(value.cached.table) && value.cached.table.every(tableRecipe) && array(value.cached.regions) && value.cached.regions.every(regionRecipe) && (value.mode === "table" || value.mode === "regions");
}
export function validateStoredToolDraft(key: string, raw: string, baseline: string): void {
  const value: unknown = JSON.parse(raw);
  if (!object(value)) throw new Error("Invalid stored tool draft");
  const valid = key === "params" ? params(value) : key === "excel" ? excel(value) : key.split(":").length > 3 ? layout(value) : rules(value);
  if (key === "params") { const definitions: unknown = JSON.parse(baseline); if (!array(definitions) || !definitions.every(item => object(item) && typeof item.field === "string")) throw new Error("Invalid stored parameter baseline"); }
  if (!valid) throw new Error(`Invalid stored ${key.split(":")[0]} draft`);
}
