// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { OutputAssetError, resolvePlanAssets, type ComponentImageContext } from "../output/assets";
import { renderPlanToPdf } from "../pdf/render-pdf";
import type { PlanComponent, RenderPlan } from "../schema/render-plan";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const qr = (): PlanComponent => ({ kind: "qrcode", leftMm: 1, topMm: 1, widthMm: 10, heightMm: 10 });
const makePlan = (...components: PlanComponent[]): RenderPlan => ({ schemaVersion: "assets", pages: [{ pageWidthMm: 50, pageHeightMm: 50, components }] });

describe("optional image renderer adapters", () => {
  it("resolves nested grid assets immutably, deduplicates reused component objects and preserves existing images", async () => {
    const code = qr();
    const nested: PlanComponent = { kind: "rect", leftMm: 0, topMm: 0, widthMm: 20, heightMm: 20, grid: { cells: [[{ children: [code] }]] } };
    const existing = { ...qr(), imageData: PNG };
    const input = makePlan(code, nested, existing);
    const renderer = vi.fn(() => PNG);
    const result = await resolvePlanAssets(input, { assetRenderers: { qrcode: renderer } });
    expect(renderer).toHaveBeenCalledOnce();
    expect(result.plan.pages[0]!.components[0]!.imageData).toBe(PNG);
    expect(result.plan.pages[0]!.components[1]!.grid!.cells[0]![0]!.children![0]!.imageData).toBe(PNG);
    expect(result.plan.pages[0]!.components[2]).toBe(existing);
    expect(input.pages[0]!.components[0]!.imageData).toBeUndefined();
    expect(input.pages[0]!.components[1]).toBe(nested);
    expect(result.diagnostics).toEqual([]);
  });

  it("passes the nested path and AbortSignal to external renderers", async () => {
    const renderer = vi.fn((_context: ComponentImageContext) => PNG);
    const input = makePlan({ kind: "rect", leftMm: 0, topMm: 0, widthMm: 20, heightMm: 20, grid: { cells: [[{ children: [qr()] }]] } });
    await resolvePlanAssets(input, { assetRenderers: { qrcode: renderer } });
    expect(renderer.mock.calls[0]).toBeDefined();
    const context = renderer.mock.calls[0]![0];
    expect(context.componentPath).toEqual([0, 0, 0]);
    expect(context.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails explicitly by default and supports an explicit diagnostic placeholder policy", async () => {
    const input = makePlan(qr());
    const renderer = () => { throw new Error("renderer offline"); };
    await expect(resolvePlanAssets(input, { assetRenderers: { qrcode: renderer } })).rejects.toBeInstanceOf(OutputAssetError);
    const result = await resolvePlanAssets(input, { assetRenderers: { qrcode: renderer }, assetFailure: "placeholder" });
    expect(result.plan).toBe(input);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "asset-render-failed", kind: "qrcode", componentPath: [] })]);
  });

  it("limits asset count and payload bytes without silently truncating output", async () => {
    await expect(resolvePlanAssets(makePlan(qr(), qr()), { assetRenderers: { qrcode: () => PNG }, assetBudget: { maxAssets: 1 } })).rejects.toMatchObject({ diagnostic: { code: "asset-budget-exceeded" } });
    await expect(resolvePlanAssets(makePlan(qr()), { assetRenderers: { qrcode: () => PNG }, assetBudget: { maxImageBytes: 1 } })).rejects.toMatchObject({ diagnostic: { code: "asset-budget-exceeded" } });
  });

  it("rejects remote URL output from an adapter; image assets must be self-contained", async () => {
    await expect(resolvePlanAssets(makePlan(qr()), { assetRenderers: { qrcode: () => "https://example.test/code.png" } })).rejects.toMatchObject({ diagnostic: { code: "asset-render-failed" } });
  });

  it("aborts pending adapters that ignore the signal, with no late mutation", async () => {
    const input = makePlan(qr());
    const controller = new AbortController();
    const pending = resolvePlanAssets(input, { assetRenderers: { qrcode: () => new Promise(() => {}) }, signal: controller.signal });
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(input.pages[0]!.components[0]!.imageData).toBeUndefined();
  });

  it("enforces a wall-clock budget while an adapter is pending", async () => {
    await expect(resolvePlanAssets(makePlan(qr()), { assetRenderers: { qrcode: () => new Promise(() => {}) }, assetBudget: { maxDurationMs: 10 } })).rejects.toThrow("maxDurationMs");
  });

  it("resolves only requested pages and does not call adapters for untouched page windows", async () => {
    const input = makePlan(qr());
    input.pages.push({ ...input.pages[0]!, components: [qr()] });
    const renderer = vi.fn(() => PNG);
    const result = await resolvePlanAssets(input, { assetRenderers: { qrcode: renderer }, start: 1, end: 1 });
    expect(renderer).toHaveBeenCalledOnce();
    expect(result.plan.pages[0]).toBe(input.pages[0]);
    expect(result.plan.pages[1]!.components[0]!.imageData).toBe(PNG);
  });

  it("PDF invokes an optional QR adapter automatically and embeds its output", async () => {
    const result = await renderPlanToPdf(makePlan(qr()), { assetRenderers: { qrcode: () => PNG } });
    expect(result.diagnostics).toEqual([]);
    expect(result.fidelityWarnings).toEqual([]);
    expect(result.pageErrors).toEqual([]);
    expect(result.bytes.byteLength).toBeGreaterThan(800);
  });
});
