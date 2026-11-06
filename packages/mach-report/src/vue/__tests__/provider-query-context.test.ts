import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createReportSource, createTableTemplate, type ReportCellEdit, type ReportProvider, type ReportQueryContext, type ReportSaveInput } from "@agile-team/mach-report";
import { createProviderEditing } from "../provider-editing";
import { captureQueryContext, captureQuerySource, queryReportIndex } from "../query-context";
import { queryPreviewPlan } from "../preview-query";
import { assertProviderSaveResult } from "../provider-save-result";
import ReportPreview from "../ReportPreview.vue";
import type { MachReportController } from "../controller";

const wrappers: VueWrapper[] = [];
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.replaceChildren(); });
const address = { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 };
const edit: ReportCellEdit = { address, previousValue: 1, previousText: "1", value: 2, text: "2", source: { datasetId: "detail", rowKey: "ROW", field: "qty", sourceScope: "scope" } };
function context(queryId = "first", revision = "v1", sourceToken = "t1"): Readonly<ReportQueryContext> {
  return captureQueryContext(["daily"], { date: "2026-11-07" }, [{ reportId: "daily", reportIndex: 0, reportScope: '[0,"daily"]', revision, sourceToken }], queryId);
}
const operation = (query?: Readonly<ReportQueryContext>) => ({ signal: new AbortController().signal, query });

async function focusBody(api: MachReportController): Promise<void> {
  const componentIndex = api.getPlan!()!.pages[0]!.components.findIndex(component => component.table?.role === "body");
  expect(componentIndex).toBeGreaterThanOrEqual(0);
  await api.focusCell!({ ...address, componentIndex });
}

describe("provider persistence bound to accepted queries", () => {
  it("uses the first query revision, advances saved metadata, and resets on a new query with identical parameters", async () => {
    const save = vi.fn().mockResolvedValueOnce({ revision: "saved-2", sourceToken: "saved-token" }).mockResolvedValue({ revision: "saved-3", sourceToken: "next-token" });
    const editing = createProviderEditing({ query: () => ({ datasets: {} }), save });
    const query = context();
    await editing.save!(edit, operation(query));
    expect(save.mock.calls[0]![0]).toMatchObject({ reportId: "daily", params: { date: "2026-11-07" }, expectedRevision: "v1", sourceToken: "t1" });
    await editing.save!(edit, operation(query));
    expect(save.mock.calls[1]![0]).toMatchObject({ expectedRevision: "saved-2", sourceToken: "saved-token" });
    await editing.save!(edit, operation(context("second", "fresh-1", "fresh-token")));
    expect(save.mock.calls[2]![0]).toMatchObject({ expectedRevision: "fresh-1", sourceToken: "fresh-token" });
  });
  it("binds ordinary mounted preview edits to queried parameters even while the next filter form changes", async () => {
    let queries = 0, saves = 0;
    const query = vi.fn(() => { queries++; return { datasets: { detail: [{ id: "ROW", qty: 1 }] }, revision: `query-${queries}`, sourceToken: `query-token-${queries}` }; });
    const save = vi.fn((_input: ReportSaveInput) => { saves++; return { revision: `saved-${saves}`, sourceToken: `saved-token-${saves}` }; });
    const provider: ReportProvider = { query, save };
    const template = createTableTemplate({ listOptions: { rowKey: "id" }, columns: [{ header: "Quantity", field: "qty", valueType: "number", editable: true }] });
    template.params = [{ field: "date", defaultValue: "2026-11-07" }];
    const wrapper = mount(ReportPreview, { attachTo: document.body, props: { reportId: "daily", fetcher: createReportSource({ daily: { template, provider } }), editable: createProviderEditing(provider), showExport: false, showPdfWindow: false } });
    wrappers.push(wrapper);
    const api = wrapper.vm as unknown as MachReportController;
    await vi.waitFor(() => expect(api.state?.loading).toBe(false));
    await focusBody(api); expect(await api.pasteSelection!("2")).toBe(true);
    expect(save.mock.calls[0]![0]).toMatchObject({ expectedRevision: "query-1", sourceToken: "query-token-1", params: { date: "2026-11-07" } });
    await api.setParams({ date: "2026-11-08" }, { reload: false });
    expect(await api.pasteSelection!("3")).toBe(true);
    expect(save.mock.calls[1]![0]).toMatchObject({ expectedRevision: "saved-1", params: { date: "2026-11-07" } });
    await api.reload(); await focusBody(api); expect(await api.pasteSelection!("4")).toBe(true);
    expect(save.mock.calls[2]![0]).toMatchObject({ expectedRevision: "query-2", sourceToken: "query-token-2", params: { date: "2026-11-08" } });
    await api.reload(); await focusBody(api); expect(await api.pasteSelection!("5")).toBe(true);
    expect(save.mock.calls[3]![0]).toMatchObject({ expectedRevision: "query-3", sourceToken: "query-token-3", params: { date: "2026-11-08" } });
  });
  it("preserves explicit legacy getters and row-source metadata precedence", async () => {
    const save = vi.fn().mockResolvedValue({ revision: "saved" });
    const provider = { query: () => ({ datasets: {} }), save };
    const editing = createProviderEditing(provider, { reportId: () => "explicit", params: () => ({ plant: "A" }), expectedRevision: () => "pinned", sourceToken: () => "pinned-token" });
    await editing.save!(edit, operation(context()));
    expect(save.mock.calls[0]![0]).toMatchObject({ reportId: "explicit", params: { plant: "A" }, expectedRevision: "pinned", sourceToken: "pinned-token" });
    const legacy = createProviderEditing(provider, { reportId: "daily" });
    await legacy.save!({ ...edit, source: { ...edit.source!, revision: "row-v1", sourceToken: "row-token" } }, operation(context()));
    expect(save.mock.calls[1]![0]).toMatchObject({ expectedRevision: "row-v1", sourceToken: "row-token" });
  });
  it("rejects missing or mixed automatic report contexts and mixed source scopes before saving", async () => {
    const save = vi.fn().mockResolvedValue({ revision: "saved" });
    const editing = createProviderEditing({ query: () => ({ datasets: {} }), save });
    await expect(editing.save!(edit, operation())).rejects.toThrow("单个报表上下文");
    await expect(editing.save!(edit, operation({ ...context(), reportIds: ["daily", "other"] }))).rejects.toThrow("单个报表上下文");
    await expect(editing.saveBatch!({ requestId: "mixed", edits: [edit, { ...edit, source: { ...edit.source!, sourceScope: "other" } }] }, operation(context()))).rejects.toMatchObject({ code: "atomic" });
    expect(save).not.toHaveBeenCalled();
  });
  it("returns typed conflict values without advancing remembered save metadata", async () => {
    const save = vi.fn().mockResolvedValueOnce({ revision: "remote-v2", conflicts: [{ editIndex: 0, code: "stale", message: "changed", currentValue: 0, revision: 2 }] }).mockResolvedValue({ revision: "saved" });
    const editing = createProviderEditing({ query: () => ({ datasets: {} }), save });
    expect(await editing.save!(edit, operation(context()))).toMatchObject({ conflicts: [{ currentValue: 0, revision: 2, source: edit.source }] });
    await editing.save!(edit, operation(context()));
    expect(save.mock.calls[1]![0].expectedRevision).toBe("v1");
  });
  it.each([{}, [], new Date(), NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects malformed conflict currentValue %s", value => {
    expect(() => assertProviderSaveResult({ revision: "v2", conflicts: [{ editIndex: 0, code: "stale", message: "changed", currentValue: value }] }, 1)).toThrow("服务器可能已提交");
  });
  it.each([{}, [], null, true, " ", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects malformed conflict revision %s", revision => {
    expect(() => assertProviderSaveResult({ revision: "v2", conflicts: [{ editIndex: 0, code: "stale", message: "changed", revision }] }, 1)).toThrow("服务器可能已提交");
  });
  it.each([null, false, 0, 1.25, "0001"])("accepts primitive remote values without coercion %s", currentValue => {
    expect(() => assertProviderSaveResult({ revision: "v2", conflicts: [{ editIndex: 0, code: "stale", message: "changed", currentValue, revision: "v1" }] }, 1)).not.toThrow();
  });
});

describe("query context capture boundaries", () => {
  it("captures immutable metadata before diagnostic observers mutate the provider result", async () => {
    const result = { datasets: {}, revision: "first", sourceToken: "first-token" };
    const outcome = await queryPreviewPlan(async input => {
      input.onQueryResult?.("daily", result, 0);
      return { schemaVersion: "query", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [] }] };
    }, { reportIds: ["daily"], params: { date: "original" }, onQueryResult: () => { result.revision = "mutated"; } });
    expect(outcome.context.sources[0]).toMatchObject({ revision: "first", sourceToken: "first-token" });
    expect(Object.isFrozen(outcome.context.params)).toBe(true);
    expect(Object.isFrozen(outcome.context.sources[0])).toBe(true);
  });
  it("isolates report IDs from custom fetcher mutation and assigns a fresh identity without a task ID", async () => {
    const fetcher = vi.fn(async input => {
      input.reportIds[0] = "mutated";
      return { schemaVersion: "query", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [] }] };
    });
    const first = await queryPreviewPlan(fetcher, { reportIds: ["daily"], params: {} });
    const second = await queryPreviewPlan(fetcher, { reportIds: ["daily"], params: {} });
    expect(first.context.reportIds).toEqual(["daily"]);
    expect(first.context.queryId).toBeTruthy();
    expect(second.context.queryId).not.toBe(first.context.queryId);
  });
  it("captures a supplied task ID before the caller changes its input object", async () => {
    const input = { reportIds: ["daily"], params: {}, taskId: "initial-task" };
    const value = await queryPreviewPlan(async () => {
      input.taskId = "later-task";
      return { schemaVersion: "query", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [] }] };
    }, input);
    expect(value.context.queryId).toBe("initial-task");
  });
  it("validates occurrence indices and revision/token shapes", () => {
    expect(queryReportIndex(["A", "A"], "A")).toBe(-1);
    expect(queryReportIndex(["A", "A"], "A", 1)).toBe(1);
    expect(queryReportIndex(["A"], "A", "0" as unknown as number)).toBe(-1);
    expect(captureQuerySource(["A"], "other", { datasets: {} }, 0)).toBeNull();
    expect(() => captureQuerySource(["A"], "A", { datasets: {}, revision: 1 as unknown as string }, 0)).toThrow("必须为字符串");
    expect(() => captureQuerySource(["A"], "A", { datasets: {}, sourceToken: 1 as unknown as string }, 0)).toThrow("必须为字符串");
  });
});
