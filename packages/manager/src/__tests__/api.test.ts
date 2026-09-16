import { describe, expect, it, vi } from "vitest";
import { createReportAdminClient } from "../api";
import type { RequestFn } from "../types";

function mockClient(responder: (url: string, config: Record<string, unknown>) => unknown) {
  const request = vi.fn(async (config: Parameters<RequestFn>[0]) =>
    responder(config.url, config as Record<string, unknown>)
  ) as unknown as RequestFn & ReturnType<typeof vi.fn>;
  return { client: createReportAdminClient({ request }), request };
}

describe("report admin client", () => {
  it("listReports 携带分页参数并解析 records", async () => {
    const { client, request } = mockClient((url) => {
      expect(url).toBe("/report/codePrintReport/list");
      return { code: 200, data: { records: [{ id: "1", name: "出库单" }], total: 1 } };
    });
    const page = await client.listReports({ current: 2, size: 50, keyword: "出库" });
    expect(page.records[0]!.name).toBe("出库单");
    const call = request.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.params).toMatchObject({ current: 2, size: 50, keyword: "出库" });
  });

  it("getReport 返回记录（content 原样透传）", async () => {
    const { client } = mockClient(() => ({
      code: 200,
      data: { id: "9", content: "{\"uitype\":\"tempContent\"}" }
    }));
    const rec = await client.getReport("9");
    expect(rec.content).toContain("tempContent");
  });

  it("updateReport 走 PUT 且 body 完整", async () => {
    const { client, request } = mockClient(() => ({ code: 200 }));
    await client.updateReport({ id: "1", name: "n", content: "{}" });
    const call = request.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.method).toBe("put");
    expect(call.url).toBe("/report/codePrintReport/update");
    expect(call.data).toEqual({ id: "1", name: "n", content: "{}" });
  });

  it("业务错误码转 ReportAdminError", async () => {
    const { client } = mockClient(() => ({ code: 500, message: "模板不存在" }));
    await expect(client.getReport("x")).rejects.toThrowError("模板不存在");
  });

  it("listDatasets/listParams 命中子资源路径", async () => {
    const { client, request } = mockClient(() => ({ code: 200, data: { records: [] } }));
    await client.listDatasets("r1");
    await client.listParams("r1");
    expect((request.mock.calls[0]![0] as Record<string, unknown>).url).toBe(
      "/report/codePrintReportDs/list"
    );
    expect((request.mock.calls[1]![0] as Record<string, unknown>).url).toBe(
      "/report/codePrintReportParam/list"
    );
  });

  it("holdLock：acquire → fn → release，异常也释放", async () => {
    const order: string[] = [];
    const { client } = mockClient((url) => {
      if (url.endsWith("acquire")) order.push("acquire");
      if (url.endsWith("release")) order.push("release");
      return { code: 200 };
    });
    const result = await client.holdLock("r1", async () => {
      order.push("fn");
      return 42;
    });
    expect(result).toBe(42);
    expect(order).toEqual(["acquire", "fn", "release"]);

    const order2: string[] = [];
    const { client: c2 } = mockClient((url) => {
      if (url.endsWith("acquire")) order2.push("acquire");
      if (url.endsWith("release")) order2.push("release");
      return { code: 200 };
    });
    await expect(
      c2.holdLock("r1", async () => {
        order2.push("boom");
        throw new Error("boom");
      })
    ).rejects.toThrowError("boom");
    expect(order2).toEqual(["acquire", "boom", "release"]);
  });

  it("importDefinition 组装 multipart（file+strategy）", async () => {
    const { client, request } = mockClient(() => ({ code: 200 }));
    const blob = new Blob(["zip"]);
    await client.importDefinition(blob, "overwrite");
    const call = request.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.method).toBe("post");
    expect(call.data).toBeInstanceOf(FormData);
  });
});
