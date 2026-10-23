import type { DatasetRows, PlanComponent, ReportTemplateDocument, TemplateComponent } from "@agile-team/mach-report";
import { isLabelImageData, resolveComponentBinding } from "../layout/record-bindings";
export interface CanvasContentSample { text: string; image?: string; error?: string; bound?: boolean }

/** The design surface samples one record only; the runtime owns the full record/copy/page sequence. */
export function canvasContentSample(component: TemplateComponent, document: ReportTemplateDocument, datasets?: DatasetRows): CanvasContentSample {
  if (component.kind === "list") return { text: component.dataset };
  const fallback = component.kind === "barcode" || component.kind === "qrcode" ? component.code?.value ?? component.fallbackText ?? component.text ?? "" : component.text ?? component.fallbackText ?? "";
  if (!component.binding) return { text: fallback, ...(component.imageData ? { image: component.imageData } : {}) };
  return boundSample(component, document, datasets);
}
function boundSample(component: PlanComponent, document: ReportTemplateDocument, datasets?: DatasetRows): CanvasContentSample {
  const binding = component.binding!;
  const repeat = document.template.repeat, row = repeat ? datasets?.[repeat.dataset]?.[0] : undefined;
  if (!row) return { text: binding.field, bound: true };
  try {
    const text = resolveComponentBinding(binding, row, { dataset: repeat?.dataset, rowIndex: 0 });
    if (component.kind === "image" && text && !isLabelImageData(text)) return { text: binding.field, bound: true, error: "image-binding" };
    return { text, bound: true, ...(component.kind === "image" && isLabelImageData(text) ? { image: text } : {}) };
  } catch (cause) {
    return { text: binding.field, bound: true, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Adaptive physical ticks stay bounded for wide reports and tiny zoom levels. */
export function canvasRulerMarks(sizeMm: number, scale: number): Array<{ mm: number; position: number }> {
  const candidates = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  const step = candidates.find(value => value * scale >= 36) ?? Math.max(1000, Math.ceil(sizeMm / 200));
  const marks = Array.from({ length: Math.min(201, Math.floor(sizeMm / step) + 1) }, (_, index) => ({ mm: index * step, position: index * step * scale }));
  return marks;
}

