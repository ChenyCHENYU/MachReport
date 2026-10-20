// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
let fonts: typeof import("../font-loader");
beforeEach(async () => { vi.resetModules(); fonts = await import("../font-loader"); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const data = (value: number, size = 4) => new Uint8Array(size).fill(value);
describe("bounded PDF font resources", () => {
  it("applies quantity and byte LRU budgets, refreshes hits and leaves evicted caller references intact", async () => {
    fonts.configureFontCache({ maxFonts: 2, maxBytes: 8, maxFontBytes: 8 });
    const fetcher = vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(data(url.charCodeAt(1)))));
    vi.stubGlobal("fetch", fetcher);
    const held = await fonts.loadFontWithCache("/a");
    await fonts.loadFontWithCache("/b");
    expect(await fonts.loadFontWithCache("/a")).toBe(held);
    await fonts.loadFontWithCache("/c");
    expect(fonts.getFontCacheStats()).toMatchObject({ fonts: 2, bytes: 8 });
    expect(held).toEqual(data(97));
    expect(await fonts.loadFontWithCache("/a")).toBe(held);
    await fonts.loadFontWithCache("/b");
    expect(fetcher.mock.calls.map((args) => args[0])).toEqual(["/a", "/b", "/c", "/b"]);
  });
  it("evicts immediately after reducing budgets and does not retain a font larger than the cache", async () => {
    fonts.configureFontCache({ maxFonts: 8, maxBytes: 8, maxFontBytes: 16 });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(data(1)))));
    await fonts.loadFontWithCache("/a"); await fonts.loadFontWithCache("/b");
    fonts.configureFontCache({ maxBytes: 3 });
    expect(fonts.getFontCacheStats()).toMatchObject({ fonts: 0, bytes: 0 });
    expect(await fonts.loadFontWithCache("/c")).toEqual(data(1));
    expect(fonts.getFontCacheStats().fonts).toBe(0);
    expect(() => fonts.configureFontCache({ maxFonts: 0 })).toThrow(/正整数/);
  });
  it("rejects declared oversized downloads before reading their body", async () => {
    fonts.configureFontCache({ maxFontBytes: 4 });
    const response = new Response(data(1, 5), { headers: { "content-length": "5" } });
    const read = vi.spyOn(response.body!, "getReader");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(fonts.loadFontWithCache("/huge", { strict: true })).rejects.toThrow(/单字体下载预算/);
    expect(read).not.toHaveBeenCalled(); expect(fonts.getFontCacheStats().bytes).toBe(0);
  });
  it("cancels chunked streams without Content-Length as soon as cumulative bytes exceed budget", async () => {
    fonts.configureFontCache({ maxFontBytes: 4 });
    let cancelled = false, reads = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(data(1, 3)); }, cancel() { cancelled = true; } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    await expect(fonts.loadFontWithCache("/chunked", { strict: true })).rejects.toThrow(/单字体下载预算/);
    expect(cancelled).toBe(true); expect(reads).toBeLessThanOrEqual(3); expect(fonts.getFontCacheStats().bytes).toBe(0);
  });
  it("cancels one subscriber promptly while preserving a shared request for others and new joiners", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const cancelled = fonts.loadFontWithCache("/shared", { signal: controller.signal });
    const remaining = fonts.loadFontWithCache("/shared");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const rejected = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await rejected;
    const joined = fonts.loadFontWithCache("/shared");
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish(new Response(data(2)));
    const [a, b] = await Promise.all([remaining, joined]);
    expect(a).toEqual(data(2)); expect(a).toBe(b); expect(fonts.getFontCacheStats().fonts).toBe(1);
  });
  it("fences a late download across clear without corrupting a later cache generation", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; })).mockImplementation(() => Promise.resolve(new Response(data(3))));
    vi.stubGlobal("fetch", fetcher);
    const old = fonts.loadFontWithCache("/same");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await fonts.clearFontCache();
    const fresh = await fonts.loadFontWithCache("/same");
    finish(new Response(data(1))); expect(await old).toEqual(data(1));
    expect(await fonts.loadFontWithCache("/same")).toBe(fresh);
    expect(fonts.getFontCacheStats()).toMatchObject({ fonts: 1, bytes: 4 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("times out a stalled response-body read and releases its reader", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ pull() { return new Promise<void>(() => undefined); }, cancel() { cancelled = true; } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const load = fonts.loadFontWithCache("/stalled", { strict: true });
    const rejected = expect(load).rejects.toThrow(/超时/);
    await vi.advanceTimersByTimeAsync(15_000); await rejected;
    expect(cancelled).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not fetch for an already cancelled subscriber", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController(); controller.abort();
    await expect(fonts.loadFontWithCache("/none", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
