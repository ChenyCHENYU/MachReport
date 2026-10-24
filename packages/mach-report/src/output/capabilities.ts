import { resolveGridLayout } from "../render/grid-geometry";
import { assertBoundedRenderTree } from "../schema/component-tree";
import { assertOutputActive, type OutputTaskOptions } from "./progress";
import { notifyOutputDiagnostic } from "./diagnostic-notification";
import type { ComponentStyle, GridCell, PlanComponent, RenderPlan } from "../schema/render-plan";
import { isImageBackedComponent } from "../schema/render-plan";

export type OutputFormat = "dom" | "canvas" | "pdf" | "xlsx";

export interface OutputDiagnostic {
  code: "invalid-image-data" | "image-budget-exceeded" | "component-render-failed" | "unsupported-text" | "output-degraded" | "missing-image" | "unsupported-component" | "unsupported-image-format" | "unsupported-style" | "rich-text-flattened" | "nested-components-omitted" | "async-image-required" | "image-decode-failed" | "asset-render-failed" | "asset-budget-exceeded";
  severity: "warning";
  format: OutputFormat;
  pageIndex: number;
  componentIndex: number;
  /** Nested grid child location as repeating [rowIndex, columnIndex, childIndex] triples. */
  componentPath?: readonly number[];
  kind: string;
  nid?: string;
  message: string;
}

export interface OutputDiagnosticOptions extends OutputTaskOptions {
  /** Structured fidelity diagnostics; rendering never silently invents missing content. */
  onDiagnostic?: (diagnostic: OutputDiagnostic) => void;
  /** Reject known unsupported content before creating an incomplete file. Default warn. */
  fidelity?: "warn" | "strict";
}

export class OutputFidelityError extends Error {
  readonly code = "output-fidelity";
  constructor(public readonly diagnostics: readonly OutputDiagnostic[]) {
    super(`Output contains ${diagnostics.length} known fidelity issue(s): ${diagnostics[0]?.code}`);
    this.name = "OutputFidelityError";
  }
}

const VECTOR_KINDS = new Set(["text", "rect", "line", "ellipse"]);
const IMAGE_KINDS = new Set(["image", "chart", "barcode", "qrcode"]);

function componentIssue(comp: PlanComponent, format: OutputFormat): Pick<OutputDiagnostic, "code" | "message"> | undefined {
  if (comp.grid) return undefined;
  if (isImageBackedComponent(comp)) {
    if ((format === "pdf" || format === "xlsx") && !/^data:image\/(png|jpe?g);base64,/i.test(comp.imageData!)) {
      return { code: "unsupported-image-format", message: `${format.toUpperCase()} accepts PNG or JPEG data URLs; convert this image before exporting.` };
    }
    return undefined;
  }
  if (IMAGE_KINDS.has(comp.kind)) return { code: "missing-image", message: `${comp.kind} requires imageData or a renderer adapter before output.` };
  if (!VECTOR_KINDS.has(comp.kind)) return { code: "unsupported-component", message: `Unsupported component kind: ${comp.kind}.` };
  if (format === "xlsx" && comp.kind !== "text") return { code: "unsupported-component", message: `XLSX data export omits ${comp.kind} geometry.` };
  return undefined;
}

function diagnostic(comp: PlanComponent, format: OutputFormat, pageIndex: number, componentIndex: number, issue: Pick<OutputDiagnostic, "code" | "message">): OutputDiagnostic {
  return { ...issue, severity: "warning", format, pageIndex, componentIndex, kind: comp.kind, nid: comp.nid };
}
function unsupportedStyle(style: ComponentStyle | undefined, format: OutputFormat): string | undefined {
  if (!style || format === "dom") return;
  const unsupported: string[] = [];
  if (style.rotateDeg) unsupported.push("rotateDeg");
  if (style.opacity !== undefined && style.opacity !== 1) unsupported.push("opacity");
  if (format !== "xlsx" && style.align === "justify") unsupported.push("justify");

  if (format === "xlsx" && style.letterSpacing) unsupported.push("letterSpacing");
  return unsupported.length ? `${format} does not preserve these styles: ${unsupported.join(", ")}.` : undefined;
}

function richExcelStyleIssue(style: ComponentStyle | undefined): string | undefined {
  if (!style) return;
  const properties = (["backgroundColor", "align", "verticalAlign", "lineHeight", "borderTop", "borderRight", "borderBottom", "borderLeft", "borderColor", "lineColor", "lineWidthPt"] as const).filter(key => style[key] !== undefined);
  return properties.length ? `XLSX rich text does not retain independent run styles: ${properties.join(", ")}.` : undefined;
}
function nestedExcelTextIssue(child: PlanComponent): Pick<OutputDiagnostic, "code" | "message"> | undefined {
  if (child.kind !== "text") return;
  const style = richExcelStyleIssue(child.style);
  if (child.leftMm || child.topMm || style) return { code: "unsupported-style", message: `Nested XLSX text is retained as rich text in component order; absolute child offsets and independent paragraph styles are not retained.${style ? ` ${style}` : ""}` };
}

function collectRichStyleDiagnostics(comp: PlanComponent, format: OutputFormat, pageIndex: number, componentIndex: number, diagnostics: OutputDiagnostic[], componentPath: readonly number[]): void {
    const add = (message: string): void => { diagnostics.push({ ...diagnostic(comp, format, pageIndex, componentIndex, { code: "unsupported-style", message }), componentPath }); };
    for (const paragraph of comp.richParagraphs ?? []) {
      if (format === "xlsx" && (paragraph.spaceBeforeMm || paragraph.spaceAfterMm || paragraph.indentMm || paragraph.align || paragraph.lineHeight)) add("XLSX rich text preserves fonts and paragraph newlines; paragraph spacing, indentation and alignment are not retained.");
      const paragraphMessage = unsupportedStyle({ align: paragraph.align }, format);
      if (paragraphMessage) add(paragraphMessage);
      for (const segment of paragraph.segments) {
        const message = unsupportedStyle(segment.style, format) ?? (format === "xlsx" ? richExcelStyleIssue(segment.style) : undefined);
        if (message) add(message);
      }
    }
}

/** Pure preflight shared by browser and server; no DOM, fonts or output libraries are loaded. */
function collectComponentDiagnostics(comp: PlanComponent, format: OutputFormat, pageIndex: number, componentIndex: number, componentPath: readonly number[], diagnostics: OutputDiagnostic[], ancestors: ReadonlySet<PlanComponent>): void {
    if (ancestors.has(comp)) return;
    const visited = new Set(ancestors).add(comp);
    const issue = componentIssue(comp, format);
    if (issue) diagnostics.push({ ...diagnostic(comp, format, pageIndex, componentIndex, issue), componentPath });
    const styleMessage = unsupportedStyle(comp.style, format);
    if (styleMessage) diagnostics.push({ ...diagnostic(comp, format, pageIndex, componentIndex, { code: "unsupported-style", message: styleMessage }), componentPath });
    collectRichStyleDiagnostics(comp, format, pageIndex, componentIndex, diagnostics, componentPath);
    collectGridDiagnostics(comp, format, pageIndex, componentIndex, componentPath, diagnostics, visited);
}

function nestedExcelIssue(child: PlanComponent, width: number, height: number): Pick<OutputDiagnostic, "code" | "message"> | undefined {
  if (child.grid) return { code: "nested-components-omitted", message: "XLSX cannot place a nested grid inside a single cell; the nested grid is omitted." };
  const textIssue = nestedExcelTextIssue(child);
  if (textIssue) return textIssue;
  if (isImageBackedComponent(child) && (child.leftMm < 0 || child.topMm < 0 || child.leftMm + child.widthMm > width + 0.001 || child.topMm + child.heightMm > height + 0.001)) return { code: "unsupported-style", message: "XLSX cannot clip a child image to a cell; it retains the original image dimensions." };
}
function nestedExcelInspector(comp: PlanComponent): (child: PlanComponent, row: number, column: number, cell: GridCell | null) => Pick<OutputDiagnostic, "code" | "message"> | undefined {
  let bounds: Map<string, { widthMm: number; heightMm: number }> | undefined;
  return (child, row, column, cell) => {
    bounds ??= new Map(resolveGridLayout(comp.grid!, comp.widthMm, comp.heightMm).cells.map(box => [`${box.ri}:${box.ci}`, box]));
    const box = bounds.get(`${row}:${column}`), padding = 2 * (comp.grid?.paddingMm ?? 0.5);
    return nestedExcelIssue(child, (box?.widthMm ?? 0) - padding - (cell?.indentMm ?? 0), (box?.heightMm ?? 0) - padding);
  };
}
function collectGridDiagnostics(comp: PlanComponent, format: OutputFormat, pageIndex: number, componentIndex: number, componentPath: readonly number[], diagnostics: OutputDiagnostic[], visited: ReadonlySet<PlanComponent>): void {
    const inspectNestedExcel = nestedExcelInspector(comp);
    for (const [rowIndex, row] of (comp.grid?.cells ?? []).entries()) for (const [columnIndex, cell] of row.entries()) {
      const cellStyleMessage = unsupportedStyle(cell?.style, format);
      if (cellStyleMessage) diagnostics.push({ ...diagnostic(comp, format, pageIndex, componentIndex, { code: "unsupported-style", message: cellStyleMessage }), componentPath: [...componentPath, rowIndex, columnIndex] });
      if (cell?.richParagraphs?.length) collectRichStyleDiagnostics({ ...comp, richParagraphs: cell.richParagraphs }, format, pageIndex, componentIndex, diagnostics, [...componentPath, rowIndex, columnIndex]);
      for (const [childIndex, child] of (cell?.children ?? []).entries()) {
        const path = [...componentPath, rowIndex, columnIndex, childIndex];
        if (format === "xlsx") {
          const issue = inspectNestedExcel(child, rowIndex, columnIndex, cell);
          if (issue) diagnostics.push({ ...diagnostic(child, format, pageIndex, componentIndex, issue), componentPath: path });
          if (child.grid) continue;
        }
        collectComponentDiagnostics(child, format, pageIndex, componentIndex, path, diagnostics, visited);
      }
    }
}

export function inspectOutputCapabilities(plan: RenderPlan, format: OutputFormat): OutputDiagnostic[] {
  assertBoundedRenderTree(plan);
  const diagnostics: OutputDiagnostic[] = [];
  plan.pages.forEach((page, pageIndex) => page.components.forEach((comp, componentIndex) => collectComponentDiagnostics(comp, format, pageIndex, componentIndex, [], diagnostics, new Set())));
  return diagnostics;
}

export function reportOutputDiagnostics(plan: RenderPlan, format: OutputFormat, options: OutputDiagnosticOptions): OutputDiagnostic[] {
  assertOutputActive(options.signal);
  const diagnostics = inspectOutputCapabilities(plan, format);
  diagnostics.forEach((entry) => notifyOutputDiagnostic(entry, options));
  if (options.fidelity === "strict" && diagnostics.length) throw new OutputFidelityError(diagnostics);
  return diagnostics;
}
