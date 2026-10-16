import { describe, expect, it } from "vitest";
import { inspectOutputCapabilities } from "../output/capabilities";
import { renderPlan } from "../render/dom";
import type { PlanComponent, RenderPlan } from "../schema/render-plan";

function plan(component: Partial<PlanComponent>): RenderPlan {
  return { schemaVersion: "output-test", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "chart", nid: "sales", leftMm: 1, topMm: 1, widthMm: 50, heightMm: 20, ...component }] }] };
}

describe("output capability preflight", () => {
  it("directed DOM lines use real SVG endpoints including zero-width/height axes", () => {
    const root = renderPlan({ schemaVersion: "line", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [
      { kind: "line", lineDirection: "up", leftMm: 0, topMm: 0, widthMm: 20, heightMm: 10 },
      { kind: "line", lineDirection: "down", leftMm: 0, topMm: 20, widthMm: 0, heightMm: 10 },
      { kind: "line", lineDirection: "down", leftMm: 0, topMm: 40, widthMm: 20, heightMm: 0 }
    ] }] }, document);
    const lines = root.querySelectorAll("svg line");
    expect(lines).toHaveLength(3);
    expect(Number(lines[0]!.getAttribute("y1"))).toBeCloseTo(10 * 96 / 25.4);
    expect(lines[0]!.getAttribute("y2")).toBe("0");
    expect(lines[1]!.getAttribute("x2")).toBe("0");
    expect(lines[2]!.getAttribute("y1")).toBe("0");
    expect(lines[2]!.getAttribute("y2")).toBe("0");
    expect(root.querySelectorAll("svg")[1]!.getAttribute("width")).toBe("1");
    expect(root.querySelectorAll("svg")[2]!.getAttribute("height")).toBe("1");
  });
  it.each(["chart", "barcode", "qrcode", "image"] as const)("%s without imageData is explicit in DOM and structured diagnostics", (kind) => {
    const input = plan({ kind });
    const warnings = inspectOutputCapabilities(input, "dom");
    expect(warnings).toEqual([expect.objectContaining({ code: "missing-image", format: "dom", pageIndex: 0, componentIndex: 0, nid: "sales", kind })]);
    const root = renderPlan(input, document);
    expect(root.querySelector(`[data-mr-unsupported='${kind}']`)?.textContent).toBe(`[${kind}]`);
  });

  it("valid image adapters share the supported image path; XLSX and PDF boundaries remain visible", () => {
    const input = plan({ imageData: "data:image/svg+xml,%3Csvg/%3E" });
    expect(inspectOutputCapabilities(input, "dom")).toEqual([]);
    expect(inspectOutputCapabilities(input, "canvas")).toEqual([]);
    expect(inspectOutputCapabilities(input, "pdf")[0]?.code).toBe("unsupported-image-format");
    expect(inspectOutputCapabilities(input, "xlsx")[0]?.code).toBe("unsupported-component");
    input.pages[0]!.components[0]!.imageData = "data:image/png;base64,aGVsbG8=";
    expect(inspectOutputCapabilities(input, "pdf")).toEqual([]);
  });

  it("reports rich text and nested components without loading a renderer", () => {
    const rich = plan({ kind: "text", richParagraphs: [{ segments: [{ text: "Revenue", style: { bold: true } }] }] });
    expect(inspectOutputCapabilities(rich, "pdf")[0]?.code).toBe("rich-text-flattened");
    const grid = plan({ kind: "rect", grid: { cells: [[{ text: "cell", children: [{ kind: "qrcode", leftMm: 0, topMm: 0, widthMm: 10, heightMm: 10 }] }]] } });
    expect(inspectOutputCapabilities(grid, "canvas")[0]?.code).toBe("nested-components-omitted");
    expect(inspectOutputCapabilities(grid, "dom")).toEqual([expect.objectContaining({ code: "missing-image", kind: "qrcode", componentPath: [0, 0, 0] })]);
  });

  it("DOM preflight callback reports unsupported chart instead of an empty shape", () => {
    const diagnostics: string[] = [];
    const root = renderPlan(plan({ fallbackText: "Chart renderer required" }), document, { onDiagnostic: (entry) => diagnostics.push(entry.code) });
    expect(diagnostics).toEqual(["missing-image"]);
    expect(root.querySelector("[role=note]")?.textContent).toBe("Chart renderer required");
  });
});
