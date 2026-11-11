// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createTemplate } from "../builder/template-builder";
import { createReportRuntime } from "../server/runtime";
import type { ReportRuntimeExecutor, ReportRuntimeExportResult } from "../server/types";
import { paginateTemplate } from "../layout/paginate";

function reports(count = 2) {
  return { sales: {
    template: createTemplate().params([{ field: "plant", required: true, defaultValue: "A" }]).page(100, 80)
      .list("rows", { leftMm: 0, topMm: 10, widthMm: 80 }, [{ field: "id", header: "ID", widthMm: 80 }]).build(),
    provider: { query: async () => ({ datasets: { rows: Array.from({ length: count }, (_, id) => ({ id })) }, revision: "r2", sourceToken: "s2", diagnostics: [{ code: "source", message: "live", severity: "info" as const }] }) }
  } };
}
describe("无界面服务端运行时", () => {
  it("describe/validate/prepare 共用参数与真实分页，返回来源修订、诊断和统计", async () => {
    const runtime = createReportRuntime({ reports: reports() });
    expect(runtime.describe()).toMatchObject([{ id: "sales", paramsSchema: { required: ["plant"] }, capabilities: { save: false } }]);
    expect(runtime.validate({ reportIds: ["sales"], params: { plant: "" } })).toMatchObject({ ok: false, issues: [{ code: "required" }] });
    const result = await runtime.prepare({ reportIds: ["sales"] });
    expect(result).toMatchObject({ stats: { rows: 2, pages: 1, cells: 3 }, revisions: { sales: { revision: "r2", sourceToken: "s2" } }, diagnostics: [{ code: "source" }] });
    expect(result.plan.pages[0]?.components.some((component) => component.grid)).toBe(true);
  });
  it("行预算在分页前拒绝，页面/单元格/输出字节预算均真实执行", async () => {
    await expect(createReportRuntime({ reports: reports(5), budget: { maxRows: 3 } }).prepare({ reportIds: ["sales"] })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxRows" });
    await expect(createReportRuntime({ reports: reports(2), budget: { maxCells: 2 } }).prepare({ reportIds: ["sales"] })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxCells" });
    await expect(createReportRuntime({ reports: reports(2), budget: { maxOutputBytes: 10 } }).export({ reportIds: ["sales"], format: "pdf" })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxOutputBytes" });
    expect(() => createReportRuntime({ reports: reports(), budget: { maxRows: NaN } })).toThrow(expect.objectContaining({ code: "budget" }));
    expect(() => createReportRuntime({ reports: reports(), budget: { maxDurationMs: 2_147_483_648 } })).toThrow(expect.objectContaining({ code: "budget" }));
    expect(() => createReportRuntime({ reports: reports(), budget: { maxPages: 1.5 } })).toThrow(expect.objectContaining({ code: "budget", path: "$.budget.maxPages" }));
  });
  it("页预算在分页过程中早停，避免先读取并生成全部一万行页面", async () => {
    let reads = 0;
    const report = reports(0).sales;
    const list = report.template.pages[0]!.components[0]!;
    if (list.kind !== "list") throw new Error("expected list");
    list.rowHeightMm = 60;
    report.provider.query = async () => ({ datasets: { rows: Array.from({ length: 10_000 }, (_, index) => ({ get id() { reads++; return index; } })) }, revision: "r2", sourceToken: "s2", diagnostics: [] });
    await expect(createReportRuntime({ reports: { sales: report }, budget: { maxPages: 1 } }).prepare({ reportIds: ["sales"] })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxPages", message: expect.stringContaining("上限 1") });
    expect(reads).toBeLessThan(10);
    const template = createTemplate().page(100, 80).text("page", { leftMm: 0, topMm: 0, widthMm: 20, heightMm: 5 }).build();
    expect(() => paginateTemplate({ pages: [...template.pages, ...template.pages] }, {}, { maxPages: 1 })).toThrow(expect.objectContaining({ code: "page-limit", limit: 1, actual: 2 }));
    expect(() => paginateTemplate(template, {}, { maxPages: 0 })).toThrow(/正安全整数/);
  });
  it("多张报表共享同一页预算，不为每个 ID 重置额度", async () => {
    const report = reports(0).sales;
    await expect(createReportRuntime({ reports: { sales: report, inventory: report }, budget: { maxPages: 1 } }).prepare({ reportIds: ["sales", "inventory"] })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxPages", message: expect.stringContaining("至少 2 页") });
  });
  it("实际懒加载 PDF/XLSX 出口，文件头有效且输出字节统计一致", async () => {
    const runtime = createReportRuntime({ reports: reports() });
    const pdf = await runtime.export({ reportIds: ["sales"], format: "pdf" });
    const xlsx = await runtime.export({ reportIds: ["sales"], format: "xlsx" });
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 4))).toBe("%PDF");
    expect([...xlsx.bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
    expect(pdf.stats.outputBytes).toBe(pdf.bytes.byteLength);
    expect(xlsx.stats.outputBytes).toBe(xlsx.bytes.byteLength);
    expect(xlsx.revisions.sales?.revision).toBe("r2");
  });
  it("取消忽略 signal 的异步取数也及时拒绝，超时给出独立错误码", async () => {
    const definition = reports();
    definition.sales.provider.query = () => new Promise(() => {});
    const runtime = createReportRuntime({ reports: definition, budget: { maxDurationMs: 20 } });
    await expect(runtime.prepare({ reportIds: ["sales"] })).rejects.toMatchObject({ code: "timeout" });
    const controller = new AbortController();
    const pending = runtime.prepare({ reportIds: ["sales"], signal: controller.signal });
    controller.abort("cancelled");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  it("可选隔离执行器接收纯请求和取消信号，默认路径不强绑 worker 框架", async () => {
    const local = createReportRuntime({ reports: reports() });
    const executor: ReportRuntimeExecutor = {
      prepare: vi.fn((input, signal) => local.prepare({ ...input, signal })),
      export: vi.fn((input, signal) => local.export({ ...input, signal }))
    };
    const runtime = createReportRuntime({ reports: reports(), executor });
    await runtime.prepare({ reportIds: ["sales"] });
    expect(executor.prepare).toHaveBeenCalledWith({ reportIds: ["sales"], taskId: expect.any(String) }, expect.any(AbortSignal), undefined);
  });
  it.each(["export", "exportPrepared"] as const)("%s rejects direct executor output in a different format before delivery", async operation => {
    const definition = reports(), prepared = await createReportRuntime({ reports: definition }).prepare({ reportIds: ["sales"] });
    const wrong: ReportRuntimeExportResult = { ...prepared, bytes: new Uint8Array([0x50, 0x4b]), format: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    const execute = vi.fn(async () => wrong);
    const runtime = createReportRuntime({ reports: definition, executor: { prepare: async () => prepared, export: execute, exportPrepared: execute } });
    const pending = operation === "export" ? runtime.export({ reportIds: ["sales"], format: "pdf" }) : runtime.exportPrepared({ prepared, format: "pdf" });
    await expect(pending).rejects.toMatchObject({ code: "validate", message: expect.stringContaining("请求格式") });
    expect(execute).toHaveBeenCalledOnce();
  });
  it.each([
    { bytes: [1, 2, 3] },
    { contentType: "application/zip" },
    { stats: { rows: 0, pages: 0, cells: 0, durationMs: NaN } },
    { diagnostics: [{ code: "bad", message: "missing severity" }] },
    { diagnosticSummary: { total: 2, counts: { bad: 2 }, entries: [], omitted: 2 } }
  ])("rejects malformed direct executor delivery metadata %s through both output entries", async patch => {
    const definition = reports(), prepared = await createReportRuntime({ reports: definition }).prepare({ reportIds: ["sales"] });
    const result = { ...prepared, format: "pdf", contentType: "application/pdf", bytes: new Uint8Array([1]), ...patch } as unknown as ReportRuntimeExportResult;
    const execute = vi.fn(async () => result);
    const runtime = createReportRuntime({ reports: definition, executor: { prepare: async () => prepared, export: execute, exportPrepared: execute } });
    await expect(runtime.export({ reportIds: ["sales"], format: "pdf" })).rejects.toMatchObject({ code: "validate" });
    await expect(runtime.exportPrepared({ prepared, format: "pdf" })).rejects.toMatchObject({ code: "validate" });
  });
  it("accepts matching direct executor files, preserves cancellation and enforces the original byte budget", async () => {
    const definition = reports(), prepared = await createReportRuntime({ reports: definition }).prepare({ reportIds: ["sales"] });
    const result: ReportRuntimeExportResult = { ...prepared, format: "pdf", contentType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) };
    const execute = vi.fn(async () => result);
    const runtime = createReportRuntime({ reports: definition, executor: { prepare: async () => prepared, export: execute, exportPrepared: execute } });
    expect(await runtime.export({ reportIds: ["sales"], format: "pdf" })).toMatchObject({ format: "pdf", stats: { outputBytes: 3 } });
    expect(await runtime.exportPrepared({ prepared, format: "pdf" })).toMatchObject({ format: "pdf", stats: { outputBytes: 3 } });
    const bounded = createReportRuntime({ reports: definition, budget: { maxOutputBytes: 2 }, executor: { prepare: async () => prepared, export: execute, exportPrepared: execute } });
    await expect(bounded.export({ reportIds: ["sales"], format: "pdf" })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxOutputBytes" });
    await expect(bounded.exportPrepared({ prepared, format: "pdf" })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxOutputBytes" });
    const controller = new AbortController(); controller.abort();
    await expect(runtime.export({ reportIds: ["sales"], format: "pdf", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(execute).toHaveBeenCalledTimes(4);
  });
});
