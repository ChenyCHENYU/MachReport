// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePlanAssets } from "../output/assets";
import { OutputFidelityError, reportOutputDiagnostics } from "../output/capabilities";
import { renderPlanToCanvas, renderPlanToCanvasAsync } from "../render/canvas";
import type { PlanComponent, RenderPlan } from "../schema/render-plan";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const component = (kind: PlanComponent["kind"] = "image"): PlanComponent => ({ kind, leftMm: 0, topMm: 0, widthMm: 10, heightMm: 10, ...(kind === "image" ? { imageData: PNG } : {}) });
const plan = (...components: PlanComponent[]): RenderPlan => ({ schemaVersion: "observers", pages: [{ pageWidthMm: 50, pageHeightMm: 50, components }] });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("resource diagnostics preserve the requested failure and cancellation policy", () => {
  it("keeps placeholder output successful and retains the renderer error when an observer throws", async () => {
    const input = plan(component("chart")); const original = new Error("renderer offline");
    const options = { assetRenderers: { chart: () => { throw original; } }, onDiagnostic: vi.fn(() => { throw new Error("observer offline"); }) };
    const result = await resolvePlanAssets(input, { ...options, assetFailure: "placeholder" });
    expect(result.plan).toBe(input); expect(result.diagnostics).toHaveLength(1); expect(result.diagnostics[0]!.code).toBe("asset-render-failed");
    await expect(resolvePlanAssets(input, options)).rejects.toMatchObject({ name: "OutputAssetError", cause: original, diagnostic: { code: "asset-render-failed" } });
    expect(options.onDiagnostic).toHaveBeenCalledTimes(2);
  });
  it("honors synchronous observer cancellation before a placeholder or a second adapter can publish", async () => {
    const controller = new AbortController(); const input = plan(component("chart"), component("chart"));
    const renderer = vi.fn(() => { throw new Error("renderer offline"); });
    await expect(resolvePlanAssets(input, { signal: controller.signal, assetFailure: "placeholder", assetRenderers: { chart: renderer }, onDiagnostic: () => { controller.abort(); throw new Error("observer offline"); } })).rejects.toMatchObject({ name: "AbortError" });
    expect(renderer).toHaveBeenCalledOnce(); expect(input.pages[0]!.components.every((entry) => entry.imageData === undefined)).toBe(true);
  });
  it("retains the wall-clock budget error even when timeout observers fail", async () => {
    vi.useFakeTimers(); const onDiagnostic = vi.fn(() => { throw new Error("observer offline"); });
    const pending = resolvePlanAssets(plan(component("chart")), { assetRenderers: { chart: () => new Promise(() => {}) }, assetBudget: { maxDurationMs: 10 }, onDiagnostic });
    const rejection = expect(pending).rejects.toMatchObject({ name: "OutputAssetError", diagnostic: { code: "asset-budget-exceeded" } });
    await vi.advanceTimersByTimeAsync(10); await rejection;
    expect(onDiagnostic).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Canvas preflight and observer isolation", () => {
  it("rejects synchronous image strict mode and pre-aborted requests before bitmap allocation", () => {
    const create = vi.spyOn(document, "createElement"); const input = plan(component());
    expect(() => renderPlanToCanvas(input, { fidelity: "strict" })).toThrow(OutputFidelityError);
    const controller = new AbortController(); controller.abort();
    expect(() => renderPlanToCanvas(input, { signal: controller.signal })).toThrowError(expect.objectContaining({ name: "AbortError" }));
    expect(create.mock.calls.filter(([tag]) => tag === "canvas")).toHaveLength(0);
  });
  it("isolates synchronous warning observers while keeping explicit async-image-required diagnostics", () => {
    const context = { scale: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn() } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    const result = renderPlanToCanvas(plan(component()), { onDiagnostic: () => { throw new Error("observer offline"); } });
    expect(result.canvases).toHaveLength(1); expect(result.diagnostics.map((entry) => entry.code)).toEqual(["async-image-required"]);
    expect(context.fillText).toHaveBeenCalledWith("[image]", expect.any(Number), expect.any(Number));
  });
  it("honors synchronous observer cancellation before any canvas is allocated", () => {
    const controller = new AbortController(); const create = vi.spyOn(document, "createElement");
    expect(() => renderPlanToCanvas(plan(component()), { signal: controller.signal, onDiagnostic: () => controller.abort() })).toThrowError(expect.objectContaining({ name: "AbortError" }));
    expect(create.mock.calls.filter(([tag]) => tag === "canvas")).toHaveLength(0);
    const input = plan(component("chart")); const second = new AbortController();
    expect(() => reportOutputDiagnostics(input, "canvas", { signal: second.signal, onDiagnostic: () => second.abort() })).toThrowError(expect.objectContaining({ name: "AbortError" }));
  });
  it("preserves the decoder failure and lets cancellation supersede it without allocating a bitmap", async () => {
    const decoder = new Error("actual decoder failure"); const create = vi.spyOn(document, "createElement");
    await expect(renderPlanToCanvasAsync(plan(component()), { imageLoader: async () => { throw decoder; }, onDiagnostic: () => { throw new Error("observer offline"); } })).rejects.toBe(decoder);
    const controller = new AbortController();
    await expect(renderPlanToCanvasAsync(plan(component()), { signal: controller.signal, imageLoader: async () => { throw decoder; }, onDiagnostic: () => controller.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(create.mock.calls.filter(([tag]) => tag === "canvas")).toHaveLength(0);
  });
  it("only requests asynchronous image handling inside the chosen page window", () => {
    const input = plan(component()); input.pages.push({ ...input.pages[0]!, components: [] });
    const context = { scale: vi.fn(), fillRect: vi.fn() } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    expect(renderPlanToCanvas(input, { start: 1, end: 1, fidelity: "strict" }).diagnostics).toEqual([]);
    expect(renderPlanToCanvas(input, { start: 0, end: -2, fidelity: "strict" }).canvases).toEqual([]);
  });
});
