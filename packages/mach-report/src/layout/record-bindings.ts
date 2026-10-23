import { formatValue } from "../format";
import type { ComponentBinding } from "../schema/component-binding";

export interface ComponentBindingContext { dataset?: string; rowIndex?: number }
/** Image bindings use the formats shared by browser preview, PDF and Excel output. */
export function isLabelImageData(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/\r\n]+=*$/.test(value);
}
export class ReportBindingError extends Error {
  readonly code = "report-binding";
  constructor(readonly path: string, message: string, readonly rowIndex?: number, readonly field?: string) {
    super(`${path}: ${message}`);
    this.name = "ReportBindingError";
  }
}
/** Reads own data properties only; a dotted field name remains a literal name. */
export function readRecordScalar(row: Record<string, unknown>, field: string, context: ComponentBindingContext = {}): unknown {
  const rowIndex = context.rowIndex ?? 0, dataset = context.dataset ?? "label";
  const path = `$.datasets.${dataset}[${rowIndex}].${field}`;
  const descriptor = Object.getOwnPropertyDescriptor(row, field);
  if (!descriptor || descriptor.get || descriptor.set) throw new ReportBindingError(path, "字段必须是记录的自有数据字段，不能缺失、使用访问器或从原型继承", rowIndex, field);
  const value: unknown = descriptor.value;
  if (value == null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
  throw new ReportBindingError(path, "绑定值应为字符串、有限数字、布尔值或空值", rowIndex, field);
}
/** The shared binding semantics for actual pagination and designer samples; never evaluates code. */
export function resolveComponentBinding(binding: ComponentBinding, row: Record<string, unknown>, context: ComponentBindingContext = {}): string {
  const value = readRecordScalar(row, binding.field, context);
  if (value == null || value === "") return binding.emptyText ?? "";
  return `${binding.prefix ?? ""}${formatValue(value, binding.format)}${binding.suffix ?? ""}`;
}
