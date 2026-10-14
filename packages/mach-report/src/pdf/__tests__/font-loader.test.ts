// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

let loadFontWithCache: typeof import("../font-loader")["loadFontWithCache"];
let invalidateFontCache: typeof import("../font-loader")["invalidateFontCache"];
const DEMO_FONT = new Uint8Array(readFileSync(new URL("../../../../../examples/minimal/public/fonts/mach-report-demo.otf", import.meta.url)));

beforeEach(async () => {
  vi.resetModules();
  ({ loadFontWithCache, invalidateFontCache } = await import("../font-loader"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("PDF 字体加载诊断", () => {
  it("兼容旧接口的 null 降级；严格模式保留 URL 和网络错误 cause", async () => {
    const cause = new TypeError("offline");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(cause));
    await expect(loadFontWithCache("/offline.ttf")).resolves.toBeNull();
    await expect(loadFontWithCache("/offline.ttf", { strict: true })).rejects.toMatchObject({
      cause,
      message: expect.stringMatching(/\/offline\.ttf.*offline/)
    });
  });

  it("HTTP 404 明确失败，不写入成功缓存，修复资源后可重试", async () => {
    const bytes = DEMO_FONT;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValue(new Response(bytes));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadFontWithCache("/retry.ttf", { strict: true })).rejects.toMatchObject({ cause: expect.any(Error), message: expect.stringContaining("HTTP 404") });
    await expect(loadFontWithCache("/retry.ttf", { strict: true })).resolves.toEqual(bytes);
    await expect(loadFontWithCache("/retry.ttf", { strict: true })).resolves.toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("通过响应 Content-Type 拒绝 HTML，不读取 SPA 正文", async () => {
    const response = new Response("<!doctype html><html>index</html>", { headers: { "content-type": "text/html" } });
    const readBody = vi.spyOn(response, "arrayBuffer");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(loadFontWithCache("/spa.ttf", { strict: true })).rejects.toMatchObject({ cause: expect.any(Error), message: expect.stringMatching(/HTML.*SPA/) });
    expect(readBody).not.toHaveBeenCalled();
  });

  it("服务误标二进制 MIME 时仍识别 HTML 内容，不缓存假字体", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(" \n<!DOCTYPE html><html>index</html>", { headers: { "content-type": "application/octet-stream" } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadFontWithCache("/disguised.ttf", { strict: true })).rejects.toThrow(/HTML.*SPA/);
    await expect(loadFontWithCache("/disguised.ttf", { strict: true })).rejects.toThrow(/HTML.*SPA/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("空字体字节明确失败并保留 cause", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array())));
    await expect(loadFontWithCache("/empty.ttf", { strict: true })).rejects.toMatchObject({ cause: expect.any(Error), message: expect.stringMatching(/\/empty\.ttf.*为空/) });
  });

  it.each([
    new TextEncoder().encode('{"error":"not a font"}'),
    new Uint8Array([1, 2, 3, 4]),
    new TextEncoder().encode("OTTO")
  ])("严格模式拒绝非字体或截断字体且不缓存，修正同 URL 后可重试", async (badBytes) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(badBytes, { headers: { "content-type": "application/octet-stream" } }))
      .mockResolvedValue(new Response(DEMO_FONT));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadFontWithCache("/fixed.ttf", { strict: true })).rejects.toMatchObject({ cause: expect.any(Error), message: expect.stringContaining("/fixed.ttf") });
    await expect(loadFontWithCache("/fixed.ttf", { strict: true })).resolves.toEqual(DEMO_FONT);
    await expect(loadFontWithCache("/fixed.ttf", { strict: true })).resolves.toEqual(DEMO_FONT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("旧宽松接口仍返回任意字节；strict 会移除旧坏缓存并重新获取", async () => {
    const oldBytes = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(oldBytes)).mockResolvedValue(new Response(DEMO_FONT));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadFontWithCache("/old-cache.ttf")).resolves.toEqual(oldBytes);
    await expect(loadFontWithCache("/old-cache.ttf")).resolves.toEqual(oldBytes);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(loadFontWithCache("/old-cache.ttf", { strict: true })).resolves.toEqual(DEMO_FONT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("显式字体缓存失效允许重新获取同 URL", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(DEMO_FONT)));
    vi.stubGlobal("fetch", fetchMock);
    await loadFontWithCache("/invalidate.ttf", { strict: true });
    await invalidateFontCache("/invalidate.ttf");
    await loadFontWithCache("/invalidate.ttf", { strict: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("失效时尚未完成的旧请求不能覆盖之后重试的新字体缓存", async () => {
    let completeOld!: (response: Response) => void;
    const oldBytes = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { completeOld = resolve; }))
      .mockResolvedValue(new Response(DEMO_FONT));
    vi.stubGlobal("fetch", fetchMock);
    const pending = loadFontWithCache("/pending.ttf");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await invalidateFontCache("/pending.ttf");
    await expect(loadFontWithCache("/pending.ttf", { strict: true })).resolves.toEqual(DEMO_FONT);
    completeOld(new Response(oldBytes));
    await expect(pending).resolves.toEqual(oldBytes);
    await expect(loadFontWithCache("/pending.ttf", { strict: true })).resolves.toEqual(DEMO_FONT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("过期 strict 请求的解析错误不能清除新代际的有效字体缓存", async () => {
    let completeOld!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { completeOld = resolve; }))
      .mockResolvedValueOnce(new Response(DEMO_FONT))
      .mockRejectedValue(new Error("fresh font must stay cached while offline"));
    vi.stubGlobal("fetch", fetchMock);
    const pending = loadFontWithCache("/strict-pending.ttf", { strict: true });
    const rejected = expect(pending).rejects.toMatchObject({
      cause: expect.any(Error), message: expect.stringContaining("/strict-pending.ttf")
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await invalidateFontCache("/strict-pending.ttf");
    await expect(loadFontWithCache("/strict-pending.ttf", { strict: true })).resolves.toEqual(DEMO_FONT);
    // 保留 OTF 签名但正文截断，触发真实字体解析失败，而非网络失败。
    completeOld(new Response(new TextEncoder().encode("OTTO")));
    await rejected;
    await expect(loadFontWithCache("/strict-pending.ttf", { strict: true })).resolves.toEqual(DEMO_FONT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("并发加载共用请求，严格与旧接口可各自决定失败方式", async () => {
    let fail!: (cause: Error) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((_resolve, reject) => { fail = reject; }));
    vi.stubGlobal("fetch", fetchMock);
    const tolerant = loadFontWithCache("/shared.ttf");
    const strict = loadFontWithCache("/shared.ttf", { strict: true });
    const rejected = expect(strict).rejects.toThrow(/offline/);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fail(new Error("offline"));
    await rejected;
    await expect(tolerant).resolves.toBeNull();
  });

  it("成功完成及超时均释放计时器，超时诊断保留取消 cause", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementationOnce((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })).mockResolvedValue(new Response(DEMO_FONT));
    vi.stubGlobal("fetch", fetchMock);
    const pending = loadFontWithCache("/timeout.ttf", { strict: true });
    const rejected = expect(pending).rejects.toMatchObject({ cause: expect.objectContaining({ name: "AbortError" }), message: expect.stringContaining("超时") });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    await expect(loadFontWithCache("/timeout.ttf", { strict: true })).resolves.toEqual(DEMO_FONT);
    expect(vi.getTimerCount()).toBe(0);
  });
});
