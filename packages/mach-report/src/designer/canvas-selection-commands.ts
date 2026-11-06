import type { ReportTemplateDocument, TemplateComponent } from "@agile-team/mach-report";
import { componentGeometry, selectedComponent, setCanvasGeometry, type CanvasSelection } from "./canvas-commands";

/** Clamp one shared delta so a group keeps its relative geometry at paper edges. */
export function canvasSelectionDelta(document: ReportTemplateDocument, selections: readonly CanvasSelection[], x: number, y: number): { x: number; y: number } {
  let left = -Infinity, right = Infinity, top = -Infinity, bottom = Infinity;
  for (const selection of selections) {
    const component = selectedComponent(document, selection);
    if (!component) continue;
    const page = document.template.pages[selection.pageIndex]!;
    const box = componentGeometry(component);
    left = Math.max(left, -box.leftMm);
    right = Math.min(right, page.widthMm - box.leftMm - box.widthMm);
    top = Math.max(top, -box.topMm);
    bottom = Math.min(bottom, page.heightMm - box.topMm - (component.kind === "list" ? 2 : box.heightMm));
  }
  return { x: Math.max(left, Math.min(right, x)), y: Math.max(top, Math.min(bottom, y)) };
}

export function translateCanvasSelection(document: ReportTemplateDocument, selections: readonly CanvasSelection[], x: number, y: number): void {
  const delta = canvasSelectionDelta(document, selections, x, y);
  for (const selection of selections) {
    const component = selectedComponent(document, selection);
    if (!component) continue;
    const box = componentGeometry(component);
    setCanvasGeometry(component, { ...box, leftMm: box.leftMm + delta.x, topMm: box.topMm + delta.y });
  }
}

export function copyCanvasComponent(component: TemplateComponent): TemplateComponent {
  const copy = JSON.parse(JSON.stringify(component)) as TemplateComponent;
  if (copy.kind === "list") delete copy.id;
  else { delete copy.nid; delete copy.rkey; }
  return copy;
}
