import type { ReportTemplate } from "../layout/paginate";
import type { ReportFieldContract } from "../schema/dataset";
import type { ValidationError } from "../schema/validate";
import { collectTemplateDatasetBindings } from "./template-bindings";

/** Stable business meaning is independent of a column's position and editable caption. */
export interface ReportTemplateFieldBinding {
  field: string;
  label?: string;
  semanticKey?: string;
  type?: ReportFieldContract["type"];
  unit?: string;
}
export interface ReportTemplateDataContract {
  /** Host-owned report/domain identity, without a query date or tenant credentials. */
  source?: string;
  datasets: Readonly<Record<string, { fields: readonly ReportTemplateFieldBinding[] }>>;
}
export interface ReportTemplateCompatibilityIssue {
  code: "contract" | "source" | "dataset" | "field" | "semantic" | "type" | "unit";
  path: string;
  message: string;
  dataset?: string;
  field?: string;
}
export interface ReportTemplateCompatibilityResult {
  ok: boolean;
  issues: ReportTemplateCompatibilityIssue[];
}
const UNSAFE = new Set(["__proto__", "prototype", "constructor"]);
const TYPES = new Set(["text", "number", "boolean", "date", "decimal"]);
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function safeName(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= 4096 && !UNSAFE.has(value);
}
function validateFields(value: unknown, path: string, errors: ValidationError[]): void {
  if (!Array.isArray(value) || !value.length || value.length > 2048) {
    errors.push({ path, message: "绑定契约应包含 1–2048 个字段" });
    return;
  }
  const fields = new Set<string>();
  value.forEach((field, index) => {
    const here = `${path}.${index}`;
    if (!object(field) || !safeName(field.field) || fields.has(field.field)) {
      errors.push({ path: here, message: "字段名应安全、非空且唯一" });
      return;
    }
    fields.add(field.field);
    for (const key of ["label", "semanticKey", "unit"]) {
      if (field[key] !== undefined && (typeof field[key] !== "string" || String(field[key]).length > 4096)) errors.push({ path: `${here}.${key}`, message: "应为不超过 4096 位的字符串" });
    }
    if (field.type !== undefined && !TYPES.has(String(field.type))) errors.push({ path: `${here}.type`, message: "未知绑定字段类型" });
  });
}
/** Shared with JSON import validation. Values/rows remain governed by DatasetContract. */
export function validateTemplateDataContract(value: unknown, path: string, errors: ValidationError[]): void {
  if (value === undefined) return;
  if (!object(value) || !object(value.datasets)) {
    errors.push({ path, message: "模板数据契约应声明 datasets" });
    return;
  }
  if (value.source !== undefined && !safeName(value.source)) errors.push({ path: `${path}.source`, message: "来源应为安全的非空业务标识" });
  const datasets = Object.entries(value.datasets);
  if (!datasets.length || datasets.length > 256) errors.push({ path: `${path}.datasets`, message: "应声明 1–256 个数据集" });
  for (const [name, dataset] of datasets) {
    const here = `${path}.datasets.${name}`;
    if (!safeName(name) || !object(dataset)) errors.push({ path: here, message: "数据集应使用安全名称和字段契约" });
    else validateFields(dataset.fields, `${here}.fields`, errors);
  }
}
function fields(contract: ReportTemplateDataContract, dataset: string) {
  return new Map(contract.datasets[dataset]?.fields.map(field => [field.field, field]) ?? []);
}
function compareField(source: ReportTemplateFieldBinding, target: ReportTemplateFieldBinding, reference: { dataset: string; field: string; path: string }, issues: ReportTemplateCompatibilityIssue[]): void {
  const label = source.label || source.field;
  for (const [key, code, caption] of [["semanticKey", "semantic", "业务含义"], ["type", "type", "类型"], ["unit", "unit", "单位"]] as const) {
    if (source[key] !== target[key] && (source[key] !== undefined || target[key] !== undefined)) issues.push({ ...reference, code, message: `字段“${label}”的${caption}不兼容（${source[key] ?? "未声明"} → ${target[key] ?? "未声明"}），请重新绑定` });
  }
}
/** Check before applying a stored template to a new host dataset. Missing provenance is explicit. */
export function inspectReportTemplateCompatibility(template: ReportTemplate, target: ReportTemplateDataContract): ReportTemplateCompatibilityResult {
  const issues: ReportTemplateCompatibilityIssue[] = [];
  const errors: ValidationError[] = [];
  validateTemplateDataContract(target, "$.target", errors);
  validateTemplateDataContract(template.dataContract, "$.template.dataContract", errors);
  if (errors.length) return { ok: false, issues: errors.map(error => ({ ...error, code: "contract" })) };
  const source = template.dataContract;
  if (!source) return { ok: false, issues: [{ code: "contract", path: "$.template.dataContract", message: "模板未声明数据来源，请核对业务字段并重新绑定" }] };
  if (source.source !== target.source) issues.push({ code: "source", path: "$.template.dataContract.source", message: `模板来源与当前报表不一致（${source.source ?? "未声明"} → ${target.source ?? "未声明"}），请从当前报表创建或重新绑定模板` });
  const checked = new Set<string>();
  for (const binding of collectTemplateDatasetBindings(template)) {
    const previous = fields(source, binding.dataset), current = fields(target, binding.dataset);
    if (!previous.size || !current.size) {
      issues.push({ code: "dataset", dataset: binding.dataset, path: binding.path, message: `数据集“${binding.dataset}”缺少来源或目标字段契约` });
      continue;
    }
    for (const reference of binding.fields) {
      if (binding.generated.has(reference.field) || reference.summary && binding.summaries.has(reference.field)) continue;
      const key = `${binding.dataset}\0${reference.field}`;
      if (checked.has(key)) continue;
      checked.add(key);
      const before = previous.get(reference.field), after = current.get(reference.field);
      const context = { ...reference, dataset: binding.dataset };
      if (!before || !after) issues.push({ ...context, code: "field", message: `数据集“${binding.dataset}”的字段“${reference.field}”未声明，请重新绑定` });
      else compareField(before, after, context, issues);
    }
  }
  return { ok: issues.length === 0, issues };
}
