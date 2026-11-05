import type { ReportTemplate } from "../layout/paginate";

/** Resolve host-owned text context by a stable meta.contextKey, preserving editable geometry. */
export function bindReportTemplateContext(template: ReportTemplate, context: Readonly<Record<string, string>>): ReportTemplate {
  const snapshot = JSON.parse(JSON.stringify(template)) as ReportTemplate;
  function visit(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const item = value as Record<string, unknown>;
    const key = (item.meta as { contextKey?: unknown } | undefined)?.contextKey;
    if (item.kind === "text" && typeof key === "string" && Object.prototype.hasOwnProperty.call(context, key)) {
      const text = context[key];
      if (typeof text !== "string") throw new TypeError("Report template context values must be strings");
      item.text = text;
      delete item.lines;
      delete item.rawText;
      delete item.richParagraphs;
    }
    Object.values(item).forEach(visit);
  }
  visit(snapshot.pages);
  return snapshot;
}
