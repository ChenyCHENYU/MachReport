// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const original = new Uint8Array(readFileSync(new URL("../../../../../examples/minimal/public/fonts/mach-report-demo.otf", import.meta.url)));
const compressed = new Uint8Array(gzipSync(original));
let fonts: typeof import("../font-loader");
beforeEach(async () => { vi.resetModules(); fonts = await import("../font-loader"); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("lossless gzip PDF font resources", () => {
  it("decodes a static gzip font before strict validation and caches original full bytes", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(compressed, { headers: { "content-type": "application/gzip", "content-length": String(compressed.byteLength) } })));
    vi.stubGlobal("fetch", fetcher);
    expect(await fonts.loadFontWithCache("/full-font.otf.gz", { strict: true })).toEqual(original);
    expect(await fonts.loadFontWithCache("/full-font.otf.gz", { strict: true })).toEqual(original);
    expect(fonts.getFontCacheStats()).toMatchObject({ fonts: 1, bytes: original.byteLength });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps automatically decoded HTTP bodies and uncompressed fonts independent of DecompressionStream", async () => {
    vi.stubGlobal("DecompressionStream", undefined);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(original, { headers: { "content-encoding": "gzip", "content-length": String(compressed.byteLength) } }))));
    expect(await fonts.loadFontWithCache("/already-decoded.otf.gz", { strict: true })).toEqual(original);
  });

  it("reports a missing decompression capability clearly, then allows retry in a repaired environment", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(compressed))));
    const native = DecompressionStream;
    vi.stubGlobal("DecompressionStream", undefined);
    await expect(fonts.loadFontWithCache("/capability.otf.gz", { strict: true })).rejects.toThrow(/不支持 gzip 字体解压.*未压缩/);
    expect(fonts.getFontCacheStats().bytes).toBe(0);
    vi.stubGlobal("DecompressionStream", native);
    expect(await fonts.loadFontWithCache("/capability.otf.gz", { strict: true })).toEqual(original);
  });

  it("rejects compressed fonts whose decoded bytes exceed the single-font budget", async () => {
    const inflated = new Uint8Array(256 * 1024).fill(65);
    const packed = new Uint8Array(gzipSync(inflated));
    expect(packed.byteLength).toBeLessThan(1024);
    fonts.configureFontCache({ maxFontBytes: 1024 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(packed)));
    await expect(fonts.loadFontWithCache("/oversized.gz", { strict: true })).rejects.toThrow(/单字体下载预算/);
    expect(fonts.getFontCacheStats().bytes).toBe(0);
  });

  it("does not cache a truncated or corrupt gzip, and a corrected response can be retried", async () => {
    const broken = compressed.subarray(0, compressed.byteLength - 8);
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(broken)).mockResolvedValueOnce(new Response(compressed));
    vi.stubGlobal("fetch", fetcher);
    await expect(fonts.loadFontWithCache("/repair.gz", { strict: true })).rejects.toThrow(/PDF 字体.*加载失败/);
    expect(fonts.getFontCacheStats().bytes).toBe(0);
    expect(await fonts.loadFontWithCache("/repair.gz", { strict: true })).toEqual(original);
  });

  it("times out stalled decompression, cancels and releases its reader, without awaiting a stalled cancellation hook", async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn(() => new Promise<void>(() => undefined));
    const output = new ReadableStream<Uint8Array>({ pull() { return new Promise<void>(() => undefined); }, cancel: cancelled });
    vi.stubGlobal("DecompressionStream", class { readable = output; writable = new WritableStream<Uint8Array>(); });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(compressed)));
    const load = fonts.loadFontWithCache("/stalled.gz", { strict: true });
    const failure = expect(load).rejects.toThrow(/超时/);
    await vi.advanceTimersByTimeAsync(15_000); await failure;
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(output.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(fonts.getFontCacheStats().bytes).toBe(0);
  });
});
