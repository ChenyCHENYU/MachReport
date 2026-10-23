// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { createCodeAssetRenderers } from "../codes";
import { createLabelTemplate } from "../builder/label-template";
import type { PlanComponent } from "../schema/render-plan";
import { defineReportTemplate } from "../source/template-registry";
import { reviewReportPublication, type ReportPublicationOptions } from "../server/publication";

const symbol = (patch: Partial<PlanComponent> = {}): PlanComponent => ({ kind: "qrcode", leftMm: 2, topMm: 2, widthMm: 20, heightMm: 20, binding: { field: "trace" }, ...patch });
const document = (components: PlanComponent[] = [symbol()]) => defineReportTemplate({ id: "material-label", name: "Material trace label", template: createLabelTemplate({ dataset: "materials", rowKey: "id", components }) });
const fixtures = [{ name: "real-symbol", datasets: { materials: [{ id: "000108A", trace: "MACH:000108A:S304H3" }] } }];

describe("strict publication with trusted image adapters", () => {
  it("defers exactly matched missing symbols until real QR generation and strict PDF encoding", async () => {
    const renderers = createCodeAssetRenderers({ dpi: 203 }), qrcode = vi.fn(renderers.qrcode);
    let inspected = false;
    const review = await reviewReportPublication(document(), { fixtures, formats: ["pdf"], strictOutputs: true, assets: { assetRenderers: { qrcode } }, onArtifact: async (_fixture, output) => {
      const pdf = await PDFDocument.load(output.bytes), page = pdf.getPage(0);
      expect(pdf.getPageCount()).toBe(1);
      expect(page.getWidth()).toBeCloseTo(80 * 72 / 25.4, 6);
      expect(page.getHeight()).toBeCloseTo(55 * 72 / 25.4, 6);
      expect(page.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict).keys()).toHaveLength(1);
      inspected = true;
    } });
    expect(review.ok, JSON.stringify(review.issues)).toBe(true);
    expect(review.issues).toEqual([]);
    expect(review.samples[0]!.diagnostics).toEqual([]);
    expect(review.artifacts).toHaveLength(1);
    expect(inspected).toBe(true);
    expect(qrcode).toHaveBeenCalledOnce();
    expect(qrcode.mock.calls[0]![0].component.code?.value).toBe("MACH:000108A:S304H3");
  });

  it.each(["pdf", "xlsx"] as const)("preserves format-local %s resource adapters", async format => {
    const options: ReportPublicationOptions = { fixtures, formats: [format], strictOutputs: true };
    options[format] = { assetRenderers: createCodeAssetRenderers({ dpi: 203 }), ...(format === "xlsx" ? { paperSize: "a4" } : {}) };
    const review = await reviewReportPublication(document(), options);
    expect(review.ok, JSON.stringify(review.issues)).toBe(true);
    expect(review.artifacts).toHaveLength(1);
    expect(review.artifacts[0]!.format).toBe(format);
  });

  it("keeps another kind without an adapter blocked before generating any resource", async () => {
    const qrcode = vi.fn(createCodeAssetRenderers().qrcode), onArtifact = vi.fn();
    const image: PlanComponent = { kind: "image", leftMm: 30, topMm: 2, widthMm: 20, heightMm: 20 };
    const review = await reviewReportPublication(document([symbol(), image]), { fixtures, formats: ["pdf"], strictOutputs: true, assets: { assetRenderers: { qrcode } }, onArtifact });
    expect(review.ok).toBe(false);
    expect(review.issues).toContainEqual(expect.objectContaining({ severity: "error", diagnostic: expect.objectContaining({ code: "missing-image", kind: "image" }) }));
    expect(qrcode).not.toHaveBeenCalled();
    expect(onArtifact).not.toHaveBeenCalled();
    expect(review.artifacts).toEqual([]);
  });

  it("does not defer unsupported styles or existing unsupported image formats", async () => {
    const qrcode = vi.fn(createCodeAssetRenderers().qrcode);
    const options: ReportPublicationOptions = { fixtures, formats: ["pdf"], strictOutputs: true, assets: { assetRenderers: { qrcode } } };
    const style = await reviewReportPublication(document([symbol({ style: { opacity: 0.5 } })]), options);
    expect(style.ok).toBe(false);
    expect(style.issues).toContainEqual(expect.objectContaining({ diagnostic: expect.objectContaining({ code: "unsupported-style" }), severity: "error" }));
    const existing = symbol({ code: { value: "trace" }, imageData: "data:image/svg+xml,%3Csvg/%3E" });
    delete existing.binding;
    const image = await reviewReportPublication(document([existing]), options);
    expect(image.ok).toBe(false);
    expect(image.issues).toContainEqual(expect.objectContaining({ diagnostic: expect.objectContaining({ code: "unsupported-image-format" }), severity: "error" }));
    expect(qrcode).not.toHaveBeenCalled();
  });

  it("does not use a PDF-only adapter to bypass missing XLSX symbols", async () => {
    const qrcode = vi.fn(createCodeAssetRenderers().qrcode);
    const review = await reviewReportPublication(document(), { fixtures, formats: ["pdf", "xlsx"], strictOutputs: true, pdf: { assetRenderers: { qrcode } } });
    expect(review.ok).toBe(false);
    expect(review.issues).toContainEqual(expect.objectContaining({ severity: "error", diagnostic: expect.objectContaining({ code: "missing-image", format: "xlsx" }) }));
    expect(qrcode).not.toHaveBeenCalled();
  });

  it("retains real strict XLSX fidelity warnings after a symbol adapter succeeds", async () => {
    const onArtifact = vi.fn();
    const review = await reviewReportPublication(document(), { fixtures, formats: ["xlsx"], strictOutputs: true, assets: { assetRenderers: createCodeAssetRenderers({ dpi: 203 }) }, onArtifact });
    expect(review.ok).toBe(false);
    expect(review.issues).toContainEqual(expect.objectContaining({ severity: "error", message: expect.stringContaining("自定义纸张") }));
    expect(review.artifacts).toEqual([]);
    expect(onArtifact).not.toHaveBeenCalled();
  });

  it.each(["throw", "placeholder"] as const)("fails real strict output when a deferred renderer fails with %s policy", async assetFailure => {
    const onArtifact = vi.fn();
    const review = await reviewReportPublication(document(), { fixtures, formats: ["pdf"], strictOutputs: true, assets: { assetFailure, assetRenderers: { qrcode: () => { throw new Error("code unavailable"); } } }, onArtifact });
    expect(review.ok).toBe(false);
    expect(review.issues.some(issue => issue.code === "output" && issue.severity === "error")).toBe(true);
    expect(review.artifacts).toEqual([]);
    expect(onArtifact).not.toHaveBeenCalled();
  });
});
