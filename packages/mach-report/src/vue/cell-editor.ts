import type { ReportCellContext, ReportCellFieldOptions, ReportCellValue } from "../editing";

export type ReportCellEditorInput = HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement;
export interface CellEditor {
  input: ReportCellEditorInput;
  root: HTMLElement;
  initialInput: string;
  value(): ReportCellValue;
  focus(): void;
  feedback(message?: string): void;
}
let editorId = 0;
const style = "position:absolute;inset:0;width:100%;height:100%;min-height:20px;box-sizing:border-box;z-index:10;resize:none;margin:0;padding:2px 4px;border:2px solid var(--mrp-btn-active-bg,#2563eb);outline:none;background:var(--mrp-toolbar-bg,#fff);color:var(--mrp-toolbar-fg,#111);font:inherit;line-height:1.25;white-space:pre-wrap;";

function choices(field: ReportCellFieldOptions): Array<{ value: ReportCellValue; label: string }> {
  if (field.type === "boolean") return [{ value: true, label: field.trueLabel ?? "是" }, { value: false, label: field.falseLabel ?? "否" }];
  return field.type === "enum" ? field.options.map((option) => ({ value: option.value, label: option.label ?? String(option.value) })) : [];
}
function selectInput(doc: Document, field: ReportCellFieldOptions, context: ReportCellContext): { input: HTMLSelectElement; value(): ReportCellValue } {
  const input = doc.createElement("select");
  const options = [{ value: null, label: "—" }, ...choices(field)];
  options.forEach((item, index) => {
    const option = doc.createElement("option"); option.value = String(index); option.textContent = item.label;
    if (Object.is(context.value, item.value) || context.value === "" && item.value === null) option.selected = true;
    input.append(option);
  });
  // An unknown current value remains visible and must be deliberately replaced.
  if (!options.some((item) => Object.is(context.value, item.value) || context.value === "" && item.value === null)) {
    const unknown = doc.createElement("option"); unknown.value = "unknown"; unknown.textContent = context.cell.text ?? String(context.value); unknown.selected = true;
    input.append(unknown);
  }
  return { input, value: () => input.value === "unknown" ? context.value : options[Number(input.value)]?.value ?? null };
}
function textInput(doc: Document, field: ReportCellFieldOptions | undefined, context: ReportCellContext): { input: ReportCellEditorInput; value(): ReportCellValue } {
  const input = field?.type === "number" || field?.type === "date" ? doc.createElement("input") : doc.createElement("textarea");
  input.value = context.value == null ? "" : String(context.value);
  if (input instanceof HTMLInputElement) {
    input.type = field?.type === "date" ? "date" : "text";
    if (field?.type === "number") input.inputMode = "decimal";
    if (field?.type === "date") { if (field.min) input.min = field.min; if (field.max) input.max = field.max; }
  }
  return { input, value: () => field?.type === "date" && input instanceof HTMLInputElement && input.validity.badInput ? "invalid-date" : input.value };
}
function description(field?: ReportCellFieldOptions): string {
  if (!field) return "";
  const parts = [field.hint, field.unit];
  if (field.type === "number" || field.type === "date") {
    if (field.min !== undefined) parts.push(`≥ ${field.min}`);
    if (field.max !== undefined) parts.push(`≤ ${field.max}`);
  }
  if (field.type === "number" && field.precision !== undefined) parts.push(`最多 ${field.precision} 位小数`);
  if (field.type === "text" && field.maxLength !== undefined) parts.push(`最多 ${field.maxLength} 字符`);
  return parts.filter(Boolean).join(" · ");
}

/** One active editor is layered above the cell; original geometry and output plans remain untouched. */
export function createCellEditor(cell: HTMLElement, label: string, context: ReportCellContext, field?: ReportCellFieldOptions): CellEditor {
  const doc = cell.ownerDocument;
  const editor = field?.type === "boolean" || field?.type === "enum" ? selectInput(doc, field, context) : textInput(doc, field, context);
  const input = editor.input;
  const root = doc.createElement("span"); root.className = "mrp-cell-editor-host"; root.style.cssText = "position:absolute;inset:0;z-index:10;";
  input.className = "mrp-cell-editor"; input.style.cssText = style;
  input.setAttribute("aria-label", field?.label ?? label);
  if (field?.required) input.setAttribute("aria-required", "true");
  const note = doc.createElement("span"); note.id = `mrp-cell-hint-${++editorId}`; note.className = "mrp-cell-editor-hint";
  note.style.cssText = "position:absolute;top:100%;left:0;min-width:100%;width:max-content;max-width:320px;box-sizing:border-box;padding:4px 8px;white-space:normal;border:1px solid var(--mrp-toolbar-border,#ddd);background:var(--mrp-toolbar-bg,#fff);color:var(--mrp-toolbar-fg,#111);font-size:12px;line-height:1.4;box-shadow:0 3px 10px #0002;z-index:11;";
  const hint = description(field); note.textContent = hint; note.hidden = !hint;
  input.setAttribute("aria-describedby", note.id);
  root.append(input, note); cell.append(root);
  return {
    input, root, initialInput: input.value, value: editor.value,
    focus: () => { input.focus(); if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement && input.type !== "date") input.select(); },
    feedback: (message) => { note.textContent = message ?? hint; note.hidden = !note.textContent; input.setAttribute("aria-invalid", message ? "true" : "false"); }
  };
}
