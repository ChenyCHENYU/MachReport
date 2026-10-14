// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchRequest, PlanLoadError } from "../adapters";

/** 全局 fetch 桩：记录入参并返回受控响应 */
function stubFetch(status = 200, body: unknown = { pages: [] }) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("createFetchRequest（零依赖请求适配器）", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("拼装 query 与请求头，返回 JSON", async () => {
    const fn = stubFetch();
    const request = createFetchRequest({ baseUrl: "/sub", headers: { "X-Trace": "1" } });
    const out = await request({ url: "/api/reports/render", method: "get", params: { reportId: "A", id: "9" } });
    expect(out).toEqual({ pages: [] });
    expect(fn).toHaveBeenCalledWith(
      "/sub/api/reports/render?reportId=A&id=9",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Accept: "application/json", "X-Trace": "1" })
      })
    );
  });

  it("无参数时不带 query 串", async () => {
    const fn = stubFetch();
    const request = createFetchRequest();
    await request({ url: "/x", method: "get" });
    expect(fn.mock.calls[0]![0]).toBe("/x");
  });

  it("合并已有 query、覆盖同名参数，并将 hash 保留在最后", async () => {
    const fn = stubFetch();
    const request = createFetchRequest({ baseUrl: "/gateway///" });
    await request({
      url: "/x?language=zh&tag=a&tag=b&id=old&id=older#preview",
      method: "get",
      params: { id: "9", label: "销售 表" }
    });
    expect(fn.mock.calls[0]![0]).toBe(
      "/gateway/x?language=zh&tag=a&tag=b&id=9&label=%E9%94%80%E5%94%AE+%E8%A1%A8#preview"
    );
  });

  it("保留绝对地址及空 params 时的原始 query/hash", async () => {
    const fn = stubFetch();
    const request = createFetchRequest();
    await request({ url: "https://example.com/x?label=hello%20world#preview", method: "get", params: {} });
    expect(fn.mock.calls[0]![0]).toBe("https://example.com/x?label=hello%20world#preview");
    await request({ url: "https://example.com/x#preview", method: "get", params: { id: "9" } });
    expect(fn.mock.calls[1]![0]).toBe("https://example.com/x?id=9#preview");
  });

  it("非 2xx 抛 PlanLoadError（含状态码）", async () => {
    stubFetch(502);
    const request = createFetchRequest();
    await expect(request({ url: "/x", method: "get" })).rejects.toThrowError(/HTTP 502/);
  });

  it("网络故障抛 PlanLoadError（fetch reject 路径）", async () => {
    const cause = new Error("network down");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(cause));
    const request = createFetchRequest();
    const err = await request({ url: "/x", method: "get" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlanLoadError);
    expect((err as Error).message).toContain("network down");
    expect((err as Error & { cause: unknown }).cause).toBe(cause);
  });

  it("无效 JSON 保留原始解析错误，提供请求地址", async () => {
    const cause = new SyntaxError("Unexpected token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(cause) }));
    const err = await createFetchRequest()({ url: "/invalid", method: "get" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlanLoadError);
    expect((err as Error).message).toContain("请求失败(/invalid)");
    expect((err as Error & { cause: unknown }).cause).toBe(cause);
  });

  it("超时中断挂起请求并给出明确语义（AbortController）", async () => {
    vi.useFakeTimers();
    try {
      // fetch 永不 resolve，只有 abort signal 能终结它
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: string, init?: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                const e = new DOMException("Aborted", "AbortError");
                reject(e);
              });
            })
        )
      );
      const request = createFetchRequest({ timeoutMs: 50 });
      const pending = request({ url: "/slow", method: "get" });
      const assertion = expect(pending).rejects.toThrowError(/请求超时\(50ms\)/);
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("响应头已到达后，超时仍会中断挂起的 JSON 响应体", async () => {
    vi.useFakeTimers();
    const external = new AbortController();
    const addListener = vi.spyOn(external.signal, "addEventListener");
    const removeListener = vi.spyOn(external.signal, "removeEventListener");
    const json = vi.fn();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      json.mockImplementation(() => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }));
      return Promise.resolve({ ok: true, json });
    }));
    const pending = createFetchRequest({ timeoutMs: 50 })({ url: "/slow-body", method: "get", signal: external.signal });
    const assertion = expect(pending).rejects.toThrowError(/请求超时\(50ms\): \/slow-body/);
    await vi.advanceTimersByTimeAsync(0);
    expect(json).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(external.signal.aborted).toBe(false);
    expect(removeListener).toHaveBeenCalledWith("abort", addListener.mock.calls[0]![1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("已取消的 signal 不发起请求，并保留取消原因", async () => {
    vi.useFakeTimers();
    const fn = stubFetch();
    const external = new AbortController();
    const reason = new Error("page disposed");
    external.abort(reason);
    const err = await createFetchRequest()({
      url: "/x", method: "get", signal: external.signal
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlanLoadError);
    expect((err as Error).message).toContain("请求已取消");
    expect((err as Error & { cause: unknown }).cause).toBe(reason);
    expect(fn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("外部取消响应体时给出取消语义并清理监听与计时器", async () => {
    vi.useFakeTimers();
    const external = new AbortController();
    const addListener = vi.spyOn(external.signal, "addEventListener");
    const removeListener = vi.spyOn(external.signal, "removeEventListener");
    const cause = new Error("changed report");
    let internalSignal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      internalSignal = init.signal;
      return Promise.resolve({
        ok: true,
        json: () => new Promise((_resolve, reject) => {
          internalSignal?.addEventListener("abort", () => reject(internalSignal?.reason), { once: true });
        })
      });
    }));
    const pending = createFetchRequest({ timeoutMs: 100 })({ url: "/x", method: "get", signal: external.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: "PlanLoadError", message: "请求已取消: /x", cause });
    await vi.advanceTimersByTimeAsync(0);
    external.abort(cause);
    await assertion;
    expect(internalSignal?.aborted).toBe(true);
    expect(removeListener).toHaveBeenCalledWith("abort", addListener.mock.calls[0]![1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["success", "http", "network", "json"])("%s 路径都清理外部 signal 监听与计时器", async (outcome) => {
    vi.useFakeTimers();
    const external = new AbortController();
    const addListener = vi.spyOn(external.signal, "addEventListener");
    const removeListener = vi.spyOn(external.signal, "removeEventListener");
    const fn = stubFetch(outcome === "http" ? 503 : 200);
    if (outcome === "network") fn.mockRejectedValue(new Error("offline"));
    if (outcome === "json") fn.mockResolvedValue({ ok: true, json: () => Promise.reject(new SyntaxError("invalid")) });
    await createFetchRequest()({ url: "/x", method: "get", signal: external.signal }).catch(() => undefined);
    expect(removeListener).toHaveBeenCalledWith("abort", addListener.mock.calls[0]![1]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
