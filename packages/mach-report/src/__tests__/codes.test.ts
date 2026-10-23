// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { decode } from "fast-png";
import { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from "@zxing/library";
import { createCodeAssetRenderers, CodeImageError, renderCodeImage } from "../codes";
import type { CodeImageOptions } from "../codes";
import type { ComponentImageContext } from "../output/assets";
import { resolvePlanAssets } from "../output/assets";
import { validateRenderPlan } from "../schema/validate";
import { RENDER_PLAN_SCHEMA_VERSION, type PlanComponent } from "../schema/render-plan";
import * as raster from "../codes/raster";

function qr(value = "22L580108"): PlanComponent {
  return { kind: "qrcode", leftMm: 0, topMm: 0, widthMm: 21, heightMm: 21, code: { value } };
}
function barcode(value = "22L580108"): PlanComponent {
  return { kind: "barcode", leftMm: 0, topMm: 0, widthMm: 66, heightMm: 15, code: { value, symbology: "code128", showText: true } };
}
function image(dataUrl: string) { return decode(Uint8Array.from(atob(dataUrl.split(",")[1]!), character => character.charCodeAt(0)), { checkCrc: true }); }
function scan(dataUrl: string, format: BarcodeFormat): string {
  const decoded = image(dataUrl);
  const source = new RGBLuminanceSource(new Uint8ClampedArray(decoded.data), decoded.width, decoded.height);
  const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, [format]], [DecodeHintType.CHARACTER_SET, "UTF-8"]]);
  return new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(source)), hints).getText();
}
function context(component: PlanComponent, signal = new AbortController().signal): ComponentImageContext {
  return { component, signal, pageIndex: 0, componentIndex: 0, componentPath: [] };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("optional portable code images", () => {
  it("decodes real QR PNGs with Unicode, URLs and independent error correction levels", async () => {
    for (const [value, correction] of [["https://example.test/coil/22L580108?plant=YTS0", "M"], ["炉号22L580 · 客户测试 🏭", "Q"], ["10001096", "H"], ["A", "L"]] as const) {
      const component = qr(value); component.code!.errorCorrection = correction;
      expect(scan(await renderCodeImage(component, { dpi: 203 }), BarcodeFormat.QR_CODE)).toBe(value);
    }
  });

  it("decodes real Code128 PNG including readable text, preserving leading zeros and spaces", async () => {
    for (const value of ["22L580108", "00001096", "MR A-1"]) {
      const data = await renderCodeImage(barcode(value), { dpi: 203 });
      expect(scan(data, BarcodeFormat.CODE_128)).toBe(value);
      const decoded = image(data), start = Math.floor(decoded.height * 0.85) * decoded.width;
      expect(Array.from(decoded.data.subarray(start)).some(pixel => pixel < 100)).toBe(true);
    }
  });

  it("encodes Code39, EAN13 and EAN8 with checksum validation", async () => {
    for (const [value, symbology, format] of [["MR-22L580", "code39", BarcodeFormat.CODE_39], ["5901234123457", "ean13", BarcodeFormat.EAN_13], ["96385074", "ean8", BarcodeFormat.EAN_8]] as const) {
      const component = barcode(value); component.code!.symbology = symbology;
      expect(scan(await renderCodeImage(component), format)).toBe(value);
    }
    await expect(renderCodeImage({ ...barcode("5901234123458"), code: { value: "5901234123458", symbology: "ean13" } })).rejects.toMatchObject({ code: "invalid-input", path: "code.value" });
  });

  it("uses explicit value first and retains the old fallbackText contract", async () => {
    const component = qr("new"), fallback = { ...component, code: undefined, fallbackText: "legacy" };
    component.fallbackText = "old";
    expect(scan(await renderCodeImage(component), BarcodeFormat.QR_CODE)).toBe("new");
    expect(scan(await renderCodeImage(fallback), BarcodeFormat.QR_CODE)).toBe("legacy");
    component.code!.value = "";
    await expect(renderCodeImage(component)).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("generates exact physical-size raster with white quiet zone and whole square modules", async () => {
    const decoded = image(await renderCodeImage(qr(), { dpi: 203 }));
    expect([decoded.width, decoded.height, decoded.channels]).toEqual([168, 168, 1]);
    const data = decoded.data;
    for (let row = 0; row < 20; row++) expect(Array.from(data.subarray(row * decoded.width, (row + 1) * decoded.width)).every(pixel => pixel === 255)).toBe(true);
    const dark = Array.from(data).filter(pixel => pixel !== 255);
    expect(dark.length).toBeGreaterThan(1000);
    expect(dark.every(pixel => pixel === 0)).toBe(true);
  });

  it("works without browser canvas, document or Node Buffer globals", async () => {
    vi.stubGlobal("Buffer", undefined); vi.stubGlobal("document", undefined); vi.stubGlobal("OffscreenCanvas", undefined);
    expect(await renderCodeImage(qr())).toMatch(/^data:image\/png;base64,iVBOR/);
  });

  it("validates UTF-8 bytes, Unicode, control characters and all code formats", async () => {
    for (const value of ["\u0000", "\ud800", "\udc00", " "]) await expect(renderCodeImage(qr(value))).rejects.toMatchObject({ code: "invalid-input", path: "code.value" });
    await expect(renderCodeImage(qr("中文"), { maxTextBytes: 5 })).rejects.toMatchObject({ code: "invalid-input" });
    await expect(renderCodeImage(barcode("中文"))).rejects.toMatchObject({ code: "invalid-input" });
    await expect(renderCodeImage({ ...barcode("abc"), code: { value: "abc", symbology: "code39" } })).rejects.toMatchObject({ code: "invalid-input" });
    await expect(renderCodeImage({ ...qr(), kind: "image" })).rejects.toMatchObject({ code: "unsupported-format" });
  });

  it("rejects distorted QR, unsafe quiet zones, unknown configuration and incompatible options", async () => {
    const invalid = [
      { ...qr(), heightMm: 20 },
      { ...qr(), code: { value: "A", quietZoneModules: 3 } },
      { ...barcode(), code: { value: "A", quietZoneModules: 9 } },
      { ...qr(), code: { value: "A", symbology: "code128" } },
      { ...qr(), code: { value: "A", showText: true } },
      { ...barcode(), code: { value: "A", errorCorrection: "H" } },
      { ...barcode(), code: { value: "A", symbology: "evil" } },
      { ...qr(), code: { value: "A", unknown: true } },
    ];
    for (const component of invalid) await expect(renderCodeImage(component as PlanComponent)).rejects.toBeInstanceOf(CodeImageError);
    await expect(renderCodeImage(qr(), { dpi: 71 })).rejects.toMatchObject({ path: "options.dpi" });
    await expect(renderCodeImage(qr(), { unknown: 1 } as CodeImageOptions)).rejects.toMatchObject({ path: "options.unknown" });
  });

  it("refuses pixel and module budgets rather than silently clipping or blurring", async () => {
    const spy = vi.spyOn(raster, "rasterCode");
    await expect(renderCodeImage(qr(), { maxPixels: 100 })).rejects.toMatchObject({ code: "capacity", path: "geometry" });
    expect(spy).not.toHaveBeenCalled();
    await expect(renderCodeImage({ ...qr(), widthMm: 2, heightMm: 2 })).rejects.toMatchObject({ code: "capacity" });
    await expect(renderCodeImage({ ...barcode(), widthMm: 5 })).rejects.toMatchObject({ code: "capacity" });
    await expect(renderCodeImage({ ...barcode(), heightMm: 1 })).rejects.toMatchObject({ code: "capacity" });
  });

  it("supports cancellation before encoding and while queued without retaining a failed image", async () => {
    const spy = vi.spyOn(raster, "rasterCode"), controller = new AbortController();
    const pending = renderCodeImage(qr(), {}, controller.signal); controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(renderCodeImage(qr(), {}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps a bounded success-only LRU, supports disabling cache and honors cached cancellation", async () => {
    const spy = vi.spyOn(raster, "rasterCode"), renderers = createCodeAssetRenderers({ maxCacheEntries: 1 });
    await renderers.qrcode(context(qr("A"))); await renderers.qrcode(context(qr("A"))); expect(spy).toHaveBeenCalledTimes(1);
    await renderers.qrcode(context(qr("B"))); await renderers.qrcode(context(qr("A"))); expect(spy).toHaveBeenCalledTimes(3);
    const controller = new AbortController(); controller.abort();
    await expect(renderers.qrcode(context(qr("A"), controller.signal))).rejects.toMatchObject({ name: "AbortError" });
    const afterHit = new AbortController(), cached = renderers.qrcode(context(qr("A"), afterHit.signal)); afterHit.abort();
    await expect(cached).rejects.toMatchObject({ name: "AbortError" });
    const uncached = createCodeAssetRenderers({ maxCacheBytes: 0 });
    await uncached.qrcode(context(qr("A"))); await uncached.qrcode(context(qr("A"))); expect(spy).toHaveBeenCalledTimes(5);
  });

  it("accounts concurrent identical successes once and evicts within the retained-byte budget", async () => {
    const spy = vi.spyOn(raster, "rasterCode"), renderers = createCodeAssetRenderers({ maxCacheEntries: 2, maxCacheBytes: 4000 });
    const duplicates = await Promise.all([renderers.qrcode(context(qr("A"))), renderers.qrcode(context(qr("A")))]);
    expect(duplicates[0]).toBe(duplicates[1]);
    expect(spy).toHaveBeenCalledTimes(2);
    await renderers.qrcode(context(qr("A"))); expect(spy).toHaveBeenCalledTimes(2);
    const tiny = createCodeAssetRenderers({ maxCacheBytes: 1 });
    await tiny.qrcode(context(qr("A"))); await tiny.qrcode(context(qr("A"))); expect(spy).toHaveBeenCalledTimes(4);
  });

  it("prepares immutable assets through the existing renderer contract", async () => {
    const plan = { schemaVersion: RENDER_PLAN_SCHEMA_VERSION, pages: [{ pageWidthMm: 80, pageHeightMm: 55, components: [qr(), barcode()] }] };
    const result = await resolvePlanAssets(plan, { assetRenderers: createCodeAssetRenderers({ dpi: 203 }) });
    expect(result.diagnostics).toEqual([]);
    expect(plan.pages[0]!.components[0]!.imageData).toBeUndefined();
    expect(scan(result.plan.pages[0]!.components[0]!.imageData!, BarcodeFormat.QR_CODE)).toBe("22L580108");
    expect(scan(result.plan.pages[0]!.components[1]!.imageData!, BarcodeFormat.CODE_128)).toBe("22L580108");
  });

  it("validates code metadata and rejects unresolved bindings in nested render plans", () => {
    const component = { ...qr(), binding: { field: "id" }, code: { quietZoneModules: 0 } };
    const plan = { pages: [{ pageWidthMm: 80, pageHeightMm: 55, components: [component, { kind: "rect", leftMm: 0, topMm: 0, widthMm: 10, heightMm: 10, grid: { cells: [[{ children: [component] }]] } }] }] };
    const result = validateRenderPlan(plan);
    expect(result.errors.filter(error => error.path.endsWith("binding"))).toHaveLength(2);
    expect(result.errors.filter(error => error.path.endsWith("quietZoneModules"))).toHaveLength(2);
  });

  it("preserves structured failures for encoder capacity and rejects malformed option objects", async () => {
    const component = qr("a".repeat(2000)); component.code!.errorCorrection = "H";
    await expect(renderCodeImage(component)).rejects.toMatchObject({ name: "CodeImageError", code: "encode-failed", path: "code.value" });
    await expect(renderCodeImage({ ...qr(), code: null } as unknown as PlanComponent)).rejects.toMatchObject({ code: "invalid-input", path: "code" });
    await expect(renderCodeImage(qr(), { maxCacheEntries: -1 })).rejects.toMatchObject({ code: "invalid-input", path: "options.maxCacheEntries" });
    const ean = { ...barcode("5901234123457"), code: { value: "5901234123457", symbology: "ean13", quietZoneModules: 10 } };
    await expect(renderCodeImage(ean as PlanComponent)).rejects.toMatchObject({ path: "code.quietZoneModules" });
  });
});
