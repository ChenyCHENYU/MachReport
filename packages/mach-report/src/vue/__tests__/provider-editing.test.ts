// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import type { ReportProvider, ReportSaveInput, ReportSaveResult, RenderPlan } from "@agile-team/mach-report";
import { createProviderEditing } from "../provider-editing";
import { normalizeReportLoadError } from "../errors";
import ReportPreview from "../ReportPreview.vue";
import type { MachReportController } from "../controller";
const mounted = new Set<VueWrapper>();
afterEach(() => { mounted.forEach((wrapper) => wrapper.unmount()); mounted.clear(); document.body.replaceChildren(); vi.restoreAllMocks(); });
const plan: RenderPlan = { schemaVersion: "provider", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 80, heightMm: 10, table: { id: "orders", rowIndex: 0, role: "body", columnKeys: ["quantity", "code"], source: { datasetId: "detail", rowKey: "ROW-01", revision: "v1", sourceToken: "token1" } }, grid: { cells: [[{ value: 2, text: "2" }, { value: "001", text: "001" }]] } }] }] };
async function create(provider: ReportProvider, params: () => Record<string, string> = () => ({ date: "2026-10-16" })) {
  const editable = createProviderEditing(provider, { reportId: "production", params });
  const wrapper = mount(ReportPreview, { props: { reportId: "production", fetcher: async () => plan, editable, showExport: false, showPdfWindow: false }, attachTo: document.body });
  mounted.add(wrapper);
  await vi.waitFor(() => expect(wrapper.find("td").exists()).toBe(true));
  const report = wrapper.vm as unknown as MachReportController;
  await report.focusCell!({ pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 });
  return { wrapper, report };
}
describe("explicit provider editing bridge", () => {
  it("maps report/query/source metadata and atomic edits, then advances revision and preserves undo semantics", async () => {
    const save = vi.fn().mockResolvedValueOnce({ revision: "v2", sourceToken: "token2" }).mockResolvedValue({ revision: "v3", sourceToken: "token3" });
    const provider: ReportProvider = { query: () => ({ datasets: {} }), save };
    let date = "2026-10-16";
    const { report } = await create(provider, () => ({ date }));
    expect(await report.pasteSelection!("8\t008")).toBe(true);
    expect(save.mock.calls[0]![0]).toMatchObject({ reportId: "production", params: { date }, expectedRevision: "v1", sourceToken: "token1", action: "edit", edits: [{ source: { rowKey: "ROW-01", field: "quantity" } }, { source: { rowKey: "ROW-01", field: "code" } }] });
    expect(save.mock.calls[0]![0].requestId).toBeTypeOf("string");
    expect(await report.undo!()).toBe(true);
    expect(save.mock.calls[1]![0]).toMatchObject({ action: "undo", expectedRevision: "v2", sourceToken: "token2" });
    date = "2026-10-17";
    expect(await report.redo!()).toBe(true);
    expect(save.mock.calls[2]![0].params).toEqual({ date });
  });
  it("maps provider edit-index conflicts back to cell identities without applying values", async () => {
    const save = vi.fn().mockResolvedValue({ revision: "v9", conflicts: [{ editIndex: 0, code: "stale", message: "生产版本冲突" }] });
    const { wrapper, report } = await create({ query: () => ({ datasets: {} }), save });
    expect(await report.pasteSelection!("8")).toBe(false);
    expect(report.getDifferences!()).toEqual([]);
    expect(wrapper.find(".mrp-conflicts").text()).toContain("生产版本冲突");
    expect(report.getPlan!()!.pages[0]!.components[0]!.grid!.cells[0]![0]!.value).toBe(2);
  });
  it("requires an explicit save capability and stable sources by default", async () => {
    expect(() => createProviderEditing({ query: () => ({ datasets: {} }) }, { reportId: "A" })).toThrow(/save/);
    const save = vi.fn().mockResolvedValue({ revision: "v2" });
    const editing = createProviderEditing({ query: () => ({ datasets: {} }), save }, { reportId: "A" });
    const operation = { signal: new AbortController().signal, requestId: "request-1", action: "edit" as const };
    await expect(editing.save!({ address: { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 }, previousValue: 1, previousText: "1", value: 2, text: "2" }, operation)).rejects.toThrow(/missing/);
    expect(save).not.toHaveBeenCalled();
  });
  it("lets explicit metadata getters override source inference and rejects wrapped save responses", async () => {
    const save = vi.fn().mockResolvedValueOnce({ revision: "global-2" }).mockResolvedValue({ data: { revision: "global-3" } });
    const editing = createProviderEditing({ query: () => ({ datasets: {} }), save }, { reportId: () => "A", expectedRevision: () => "global-1", sourceToken: () => "global-token" });
    const edit = { address: { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 }, previousValue: 1, previousText: "1", value: 2, text: "2", source: { datasetId: "detail", rowKey: "1", field: "quantity", revision: "row-1" } };
    const operation = { signal: new AbortController().signal, requestId: "request-1" };
    await editing.save!(edit, operation);
    expect(save.mock.calls[0]![0]).toMatchObject({ expectedRevision: "global-1", sourceToken: "global-token", requestId: "request-1" });
    await expect(editing.save!(edit, operation)).rejects.toThrow(/解包业务响应/);
  });
  it.each([
    { revision: "v2", sourceToken: {} },
    { revision: "v2", diagnostics: {} },
    { revision: "v2", diagnostics: [{ code: "warning", message: "missing severity" }] },
    { revision: "v2", conflicts: [{ editIndex: -1, code: "stale", message: "bad index" }] },
    { revision: "v2", conflicts: [{ editIndex: 9, code: "stale", message: "bad index" }] },
    { revision: "v2", conflicts: [null] }
  ])("rejects malformed save metadata without applying cells and explains the possible committed state", async (result) => {
    const save = vi.fn().mockResolvedValue(result);
    const { wrapper, report } = await create({ query: () => ({ datasets: {} }), save });
    expect(await report.pasteSelection!("8")).toBe(false);
    expect(save).toHaveBeenCalledOnce();
    expect(report.getPlan!()!.pages[0]!.components[0]!.grid!.cells[0]![0]!.value).toBe(2);
    expect(report.getDifferences!()).toEqual([]);
    expect(wrapper.text()).toContain("服务器可能已提交，请重新查询确认");
  });
  it.each(["A", "B"])("late saves cannot replace the latest metadata for query %s", async (nextReport) => {
    let reportId = "A", resolveFirst!: (result: ReportSaveResult) => void;
    const save = vi.fn(async (input: ReportSaveInput): Promise<ReportSaveResult> => input.requestId === "first"
      ? new Promise((resolve) => { resolveFirst = resolve; })
      : { revision: "latest-2", sourceToken: "latest-token" });
    const editing = createProviderEditing({ query: () => ({ datasets: {} }), save }, { reportId: () => reportId, requireSource: false });
    const edit = { address: { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 }, previousValue: 1, previousText: "1", value: 2, text: "2" };
    const operation = { signal: new AbortController().signal };
    const first = editing.save!(edit, { ...operation, requestId: "first" });
    reportId = nextReport;
    await editing.save!(edit, { ...operation, requestId: "second" });
    resolveFirst({ revision: "old-1", sourceToken: "old-token" }); await first;
    await editing.save!(edit, { ...operation, requestId: "third" });
    expect(save.mock.calls[2]![0]).toMatchObject({ reportId: nextReport, expectedRevision: "latest-2", sourceToken: "latest-token" });
  });
});

describe("cross-thread source error classification", () => {
  it.each([["params", "param"], ["config", "config"], ["validate", "validate"], ["fetch", "fetch"], ["__proto__", "fetch"], ["unknown", "fetch"]])("accepts only known source error code %s", (code, expected) => {
    const remote = Object.assign(new Error("Remote validation"), { code, issues: [{ field: "date", code: "required" }] });
    const result = normalizeReportLoadError(remote);
    expect(result.code).toBe(expected);
    expect(result.cause).toBe(remote);
  });
});
