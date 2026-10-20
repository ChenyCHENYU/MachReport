import type { ExcelBindingField } from "./binding-workflow";
import type { ExcelBindingColumn } from "./bind-template";

export function bindingColumn(field: ExcelBindingField): Exclude<ExcelBindingColumn, string> {
  const semanticRole =
    field.semanticRole ??
    (field.type === "number" || field.type === "decimal"
      ? "measure"
      : field.type === "date"
        ? "date"
        : "text");
  return {
    field: field.field,
    semanticRole,
    editable: false,
    ...(field.type === "number" && field.digits !== undefined
      ? { format: { kind: "number" as const, digits: field.digits } }
      : {}),
    ...(field.type === "date"
      ? { format: { kind: "date" as const, pattern: "YYYY-MM-DD" } }
      : {}),
  };
}
