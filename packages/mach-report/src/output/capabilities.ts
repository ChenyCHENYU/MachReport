import { assertOutputActive, type OutputTaskOptions } from "./progress";
import { notifyOutputDiagnostic } from "./diagnostic-notification";
import type { ComponentStyle, PlanComponent, RenderPlan } from "../schema/render-plan";
import { isImageBackedComponent, isRichText } from "../schema/render-plan";

export type OutputFormat = "dom" | "canvas" | "pdf" | "xlsx";

export interface OutputDiagnostic {
  code: "missing-image" | "unsupported-component" | "unsupported-image-format" | "unsupported-style" | "rich-text-flattened" | "nested-components-omitted" | "async-image-required" | "image-decode-failed" | "asset-render-failed" | "asset-budget-exceeded";
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
  if (format === "canvas" && style.underline) unsupported.push("underline");
  if (format === "xlsx" && style.letterSpacing) unsupported.push("letterSpacing");
  return unsupported.length ? `${format} does not preserve these styles: ${unsupported.join(", ")}.` : undefined;
}

/** Pure preflight shared by browser and server; no DOM, fonts or output libraries are loaded. */
function collectComponentDiagnostics(comp: PlanComponent, format: OutputFormat, pageIndex: number, componentIndex: number, componentPath: readonly number[], diagnostics: OutputDiagnostic[], ancestors: ReadonlySet<PlanComponent>): void {
    if (ancestors.has(comp)) return;
    const visited = new Set(ancestors).add(comp);
    const issue = componentIssue(comp, format);
    if (issue) diagnostics.push({ ...diagnostic(comp, format, pageIndex, componentIndex, issue), componentPath });
    const styleMessage = unsupportedStyle(comp.style, format);
    if (styleMessage) diagnostics.push({ ...diagnostic(comp, format, pageIndex, componentIndex, { code: "unsupported-style", message: styleMessage }), componentPath });
    if (isRichText(comp) && format !== "dom") {
      diagnostics.push(diagnostic(comp, format, pageIndex, componentIndex, { code: "rich-text-flattened", message: "Rich text is exported as plain text; inline styles are not preserved." }));
    }
    for (const [rowIndex, row] of (comp.grid?.cells ?? []).entries()) for (const [columnIndex, cell] of row.entries()) {
      const cellStyleMessage = unsupportedStyle(cell?.style, format);
      if (cellStyleMessage) diagnostics.push({ ...diagnostic(comp, format, pageIndex, componentIndex, { code: "unsupported-style", message: cellStyleMessage }), componentPath: [...componentPath, rowIndex, columnIndex] });
      if (cell?.children?.length && format !== "dom") {
        diagnostics.push({ ...diagnostic(comp, format, pageIndex, componentIndex, { code: "nested-components-omitted", message: "Nested grid components are omitted; cell text is preserved." }), componentPath: [...componentPath, rowIndex, columnIndex] });
      } else if (format === "dom") {
        for (const [childIndex, child] of (cell?.children ?? []).entries()) collectComponentDiagnostics(child, format, pageIndex, componentIndex, [...componentPath, rowIndex, columnIndex, childIndex], diagnostics, visited);
      }
    }
}

export function inspectOutputCapabilities(plan: RenderPlan, format: OutputFormat): OutputDiagnostic[] {
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
