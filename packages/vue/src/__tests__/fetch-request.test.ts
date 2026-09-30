// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createFetchRequest, PlanLoadError } from "../adapters";

/** 全局 fetch 桩：记录入参并返回受控响应 */
function stubFetch(status = 200, body: unknown = { code: 200, data: {} }) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("createFetchRequest（零依赖请求适配器）", () => {
  it("拼装 query 与请求头，返回 JSON", async () => {
    const fn = stubFetch();
    const request = createFetchRequest({ baseUrl: "/sub", headers: { "X-Trace": "1" } });
    const out = await request({ url: "/report/codePrintReport/gridPlan", method: "get", params: { tempId: "A", id: "9" } });
    expect(out).toEqual({ code: 200, data: {} });
    expect(fn).toHaveBeenCalledWith(
      "/sub/report/codePrintReport/gridPlan?tempId=A&id=9",
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

  it("非 2xx 抛 PlanLoadError（含状态码）", async () => {
    stubFetch(502);
    const request = createFetchRequest();
    await expect(request({ url: "/x", method: "get" })).rejects.toThrowError(/HTTP 502/);
  });

  it("网络故障抛 PlanLoadError（fetch reject 路径）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const request = createFetchRequest();
    const err = await request({ url: "/x", method: "get" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlanLoadError);
    expect((err as Error).message).toContain("network down");
  });
});
