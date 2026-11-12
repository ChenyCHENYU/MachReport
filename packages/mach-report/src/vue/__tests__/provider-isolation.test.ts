// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, createSSRApp, defineComponent, h, nextTick, reactive, shallowRef } from "vue";
import { renderToString } from "vue/server-renderer";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createReportSource, createTableTemplate, type RenderPlan, type ReportCellEdit, type ReportProvider, type ReportQueryContext, type ReportSaveInput } from "@agile-team/mach-report";
import ReportPreview from "../ReportPreview.vue";
import type { MachReportController } from "../controller";
import { createProviderEditing } from "../provider-editing";
import { defineMachReportConfig } from "../config";
import { MACH_REPORT_CONFIG_KEY } from "../injection-keys";
import { createProviderEditingScope } from "../provider-editing-scope";
import { useEditHistory } from "../composables/useEditHistory";

const wrappers: VueWrapper[] = [];
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); });
const address = { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 };
function edit(revision?: string, sourceToken?: string): ReportCellEdit {
  return { address, previousValue: 1, previousText: "1", value: 2, text: "2", source: { datasetId: "detail", rowKey: "ROW", field: "qty", revision, sourceToken } };
}
function query(queryId = "query", revision = "v1", sourceToken = "t1"): ReportQueryContext {
  return { queryId, reportIds: ["daily"], params: {}, sources: [{ reportId: "daily", reportIndex: 0, reportScope: "daily", revision, sourceToken }] };
}
const operation = (value: ReportQueryContext) => ({ signal: new AbortController().signal, query: value });
async function focus(api: MachReportController) {
  const componentIndex = api.getPlan!()!.pages[0]!.components.findIndex(component => component.table?.role === "body");
  await api.focusCell!({ ...address, componentIndex });
}

it.each(["prop", "app-default"])("isolates a shared editing bridge across live previews (%s)", async location => {
  const revisions = new Map([["A", 1], ["B", 1]]);
  const save = vi.fn((input: ReportSaveInput) => {
    const version = revisions.get(input.reportId)!;
    if (input.expectedRevision !== `${input.reportId}-${version}` || input.sourceToken !== `${input.reportId}-t${version}`) return { revision: `${input.reportId}-${version}`, conflicts: [{ editIndex: 0, code: "stale", message: "stale version" }] };
    revisions.set(input.reportId, version + 1);
    return { revision: `${input.reportId}-${version + 1}`, sourceToken: `${input.reportId}-t${version + 1}` };
  });
  const provider: ReportProvider = { query: ({ reportId }) => ({ datasets: { detail: [{ id: "ROW", qty: 1 }] }, revision: `${reportId}-${revisions.get(reportId)}`, sourceToken: `${reportId}-t${revisions.get(reportId)}` }), save };
  const template = createTableTemplate({ listOptions: { rowKey: "id" }, columns: [{ field: "qty", header: "Quantity", valueType: "number", editable: true }] });
  const fetcher = createReportSource({ A: { template, provider }, B: { template, provider } });
  const shared = createProviderEditing(provider);
  const config = reactive(defineMachReportConfig({ defaults: { editable: shared } }));
  const previews = ["A", "B"].map(reportId => {
    const wrapper = mount(ReportPreview, { attachTo: document.body, props: { reportId, fetcher, ...(location === "prop" ? { editable: shared } : {}), showExport: false, showPdfWindow: false }, global: { provide: { [MACH_REPORT_CONFIG_KEY as unknown as string]: computed(() => config) } } });
    wrappers.push(wrapper); return wrapper.vm as unknown as MachReportController;
  });
  for (const api of previews) { await vi.waitFor(() => expect(api.state?.loading).toBe(false)); await focus(api); }
  expect(await previews[0]!.pasteSelection!("2")).toBe(true);
  expect(await previews[1]!.pasteSelection!("2")).toBe(true);
  if (location === "prop") {
    await wrappers[0]!.setProps({ editable: false });
    await wrappers[0]!.setProps({ editable: shared });
  } else {
    config.defaults.editable = false; await nextTick();
    config.defaults.editable = shared; await nextTick();
  }
  await focus(previews[0]!);
  expect(await previews[0]!.pasteSelection!("3")).toBe(true);
  expect(save.mock.calls.map(([input]) => [input.reportId, input.expectedRevision, input.sourceToken])).toEqual([["A", "A-1", "A-t1"], ["B", "B-1", "B-t1"], ["A", "A-2", "A-t2"]]);
  await previews[0]!.reload(); await focus(previews[0]!);
  expect(await previews[0]!.pasteSelection!("4")).toBe(true);
  expect(save.mock.calls[3]![0]).toMatchObject({ expectedRevision: "A-3", sourceToken: "A-t3" });
});

describe("receipt metadata remains owned by the edited source", () => {
  it("does not upgrade another preview scope's stale view even for the same query identity", async () => {
    const save = vi.fn().mockResolvedValue({ revision: "v2", sourceToken: "t2" });
    const editing = createProviderEditing({ query: () => ({ datasets: {} }), save });
    const first = createProviderEditingScope()(editing), second = createProviderEditingScope()(editing);
    const context = query();
    await first.save!(edit("v1", "t1"), operation(context));
    await second.save!(edit("v1", "t1"), operation({ ...context }));
    expect(save.mock.calls[1]![0]).toMatchObject({ expectedRevision: "v1", sourceToken: "t1" });
  });
  it("keeps initial query-level metadata authoritative when rows have their own versions", async () => {
    const save = vi.fn().mockResolvedValue({ revision: "v2", sourceToken: "t2" });
    const editing = createProviderEditing({ query: () => ({ datasets: {} }), save });
    await editing.save!(edit("row-1", "row-token"), operation(query()));
    expect(save.mock.calls[0]![0]).toMatchObject({ expectedRevision: "v1", sourceToken: "t1" });
  });
  it("preserves a prior receipt field when a later successful save omits it", async () => {
    const save = vi.fn().mockResolvedValueOnce({ revision: "v2", sourceToken: "t2" }).mockResolvedValueOnce({ revision: "v3" }).mockResolvedValue({ revision: "v4" });
    const editing = createProviderEditing({ query: () => ({ datasets: {} }), save });
    const context = query();
    await editing.save!(edit(), operation(context));
    await editing.save!(edit(), operation(context));
    await editing.save!(edit(), operation(context));
    expect(save.mock.calls[2]![0]).toMatchObject({ expectedRevision: "v3", sourceToken: "t2" });
  });
  it("does not carry a receipt into refreshed metadata even if an advanced caller reuses a query ID", async () => {
    const save = vi.fn().mockResolvedValue({ revision: "v2", sourceToken: "t2" });
    const editing = createProviderEditing({ query: () => ({ datasets: {} }), save });
    await editing.save!(edit(), operation(query()));
    await editing.save!(edit(), operation(query("query", "fresh", "fresh-token")));
    expect(save.mock.calls[1]![0]).toMatchObject({ expectedRevision: "fresh", sourceToken: "fresh-token" });
  });
});

it("keeps query-wide receipts for untouched datasets with independent row metadata", async () => {
  const save = vi.fn().mockResolvedValue({ revision: "saved-2", sourceToken: "saved-token" });
  const editing = createProviderEditing({ query: () => ({ datasets: {} }), save });
  const context = query();
  await editing.save!(edit("row-1", "row-token"), operation(context));
  await editing.save!({ ...edit("cost-row-1", "cost-row-token"), source: { ...edit("cost-row-1", "cost-row-token").source!, datasetId: "cost" } }, operation(context));
  expect(save.mock.calls[1]![0]).toMatchObject({ expectedRevision: "saved-2", sourceToken: "saved-token" });
});

it("keeps token fallback at query level when only revision advances", async () => {
  const save = vi.fn().mockResolvedValue({ revision: "saved-2" });
  const editing = createProviderEditing({ query: () => ({ datasets: {} }), save });
  const context = query();
  await editing.save!(edit("row-1", "row-token"), operation(context));
  await editing.save!(edit("cost-row-1", "cost-row-token"), operation(context));
  expect(save.mock.calls[1]![0]).toMatchObject({ expectedRevision: "saved-2", sourceToken: "t1" });
});

it("does not advance metadata when a token-only response violates the required revision contract", async () => {
  const save = vi.fn().mockResolvedValueOnce({ sourceToken: "not-a-valid-receipt" }).mockResolvedValue({ revision: "saved-2" });
  const editing = createProviderEditing({ query: () => ({ datasets: {} }), save });
  const context = query();
  await expect(editing.save!(edit("row-1", "row-token"), operation(context))).rejects.toThrow("revision");
  await editing.save!(edit("cost-row-1", "cost-row-token"), operation(context));
  expect(save.mock.calls[1]![0]).toMatchObject({ expectedRevision: "v1", sourceToken: "t1" });
});

it("preserves callback overrides and dynamic controls without replacing host persistence", async () => {
  const providerSave = vi.fn().mockResolvedValue({ revision: "v2" });
  const editing = createProviderEditing({ query: () => ({ datasets: {} }), save: providerSave });
  const customBatch = vi.fn().mockResolvedValue({ revision: "host" });
  const scope = createProviderEditingScope();
  const overridden = { ...editing, saveBatch: customBatch };
  expect(scope(overridden).saveBatch).toBe(customBatch);
  await scope(overridden).saveBatch!({ requestId: "host", edits: [edit()] }, operation(query()));
  expect(customBatch).toHaveBeenCalledOnce(); expect(providerSave).not.toHaveBeenCalled();
  const single = vi.fn().mockResolvedValue({ revision: "single" });
  const custom = { ...editing, saveBatch: undefined, save: single };
  expect(scope(custom).save).toBe(single);
  const own = scope(editing), wrapped = scope({ ...editing, canEdit: () => false });
  expect(wrapped.saveBatch).toBe(own.saveBatch);
  expect(wrapped.save).toBe(own.save);
});

it("keeps out-of-order receipts within their owning preview scope", async () => {
  let resolveFirst!: (value: { revision: string; sourceToken: string }) => void;
  const save = vi.fn((input: ReportSaveInput) => input.requestId === "first"
    ? new Promise<{ revision: string; sourceToken: string }>(resolve => { resolveFirst = resolve; })
    : Promise.resolve({ revision: "other-2", sourceToken: "other-token" }));
  const bridge = createProviderEditing({ query: () => ({ datasets: {} }), save });
  const left = createProviderEditingScope()(bridge), right = createProviderEditingScope()(bridge), context = query();
  const pending = left.save!(edit(), { ...operation(context), requestId: "first" });
  await right.save!(edit(), { ...operation({ ...context }), requestId: "second" });
  resolveFirst({ revision: "first-2", sourceToken: "first-token" }); await pending;
  await right.save!(edit(), operation({ ...context }));
  await left.save!(edit(), operation({ ...context }));
  expect(save.mock.calls[2]![0]).toMatchObject({ expectedRevision: "other-2", sourceToken: "other-token" });
  expect(save.mock.calls[3]![0]).toMatchObject({ expectedRevision: "first-2", sourceToken: "first-token" });
});

it("does not remember a completed receipt after its owning operation was canceled", async () => {
  let resolve!: (value: { revision: string }) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise<{ revision: string }>(done => { resolve = done; })).mockResolvedValue({ revision: "v2" });
  const bridge = createProviderEditing({ query: () => ({ datasets: {} }), save });
  const editing = createProviderEditingScope()(bridge), context = query(), controller = new AbortController();
  const pending = editing.save!(edit(), { query: context, signal: controller.signal });
  controller.abort(); resolve({ revision: "canceled-receipt" });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await editing.save!(edit(), operation({ ...context }));
  expect(save.mock.calls[1]![0]).toMatchObject({ expectedRevision: "v1", sourceToken: "t1" });
});

it("isolates a bridge supplied by another loaded SDK module copy", async () => {
  const save = vi.fn().mockResolvedValue({ revision: "v2", sourceToken: "t2" });
  const editing = createProviderEditing({ query: () => ({ datasets: {} }), save });
  vi.resetModules();
  const remote = await import("../provider-editing-scope");
  const left = remote.createProviderEditingScope()(editing), right = remote.createProviderEditingScope()(editing);
  await left.save!(edit(), operation(query()));
  await right.save!(edit(), operation(query()));
  expect(save.mock.calls[1]![0]).toMatchObject({ expectedRevision: "v1", sourceToken: "t1" });
});

it("uses non-enumerable factory metadata and ignores foreign markers not owned by the callback", () => {
  const bridge = createProviderEditing({ query: () => ({ datasets: {} }), save: () => ({ revision: "v2" }) });
  const marker = Symbol.for("mach-report/provider-editing-factory/v1");
  expect(Object.getOwnPropertyDescriptor(bridge.save!, marker)).toMatchObject({ enumerable: false, writable: false, configurable: false });
  const save = vi.fn(), other = vi.fn(), create = vi.fn();
  Object.defineProperty(save, marker, { value: { create, save: other } });
  expect(createProviderEditingScope()({ save }).save).toBe(save);
  expect(create).not.toHaveBeenCalled();
});

it("does not inspect or replace unusual host callbacks when private metadata cannot be read", () => {
  const save = new Proxy(vi.fn(), { getOwnPropertyDescriptor() { throw new Error("host callback introspection"); } });
  const editing = { save };
  expect(createProviderEditingScope()(editing)).toBe(editing);
  const malformed = vi.fn();
  Object.defineProperty(malformed, Symbol.for("mach-report/provider-editing-factory/v1"), { value: 1 });
  expect(createProviderEditingScope()({ save: malformed }).save).toBe(malformed);
});

it("does not share persistence receipts across server-rendered editing sessions", async () => {
  const save = vi.fn().mockResolvedValue({ revision: "saved-2", sourceToken: "saved-token" });
  const bridge = createProviderEditing({ query: () => ({ datasets: {} }), save });
  const Request = defineComponent({
    async setup() {
      const plan = shallowRef<RenderPlan | null>({ schemaVersion: "ssr", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{
        kind: "rect", leftMm: 0, topMm: 0, widthMm: 80, heightMm: 8,
        table: { id: "detail", role: "body", rowIndex: 0, columnKeys: ["qty"], source: { datasetId: "detail", rowKey: "ROW" } },
        grid: { cells: [[{ text: "1", value: 1, editable: true }]] }
      }] }] });
      const history = useEditHistory({ plan, options: shallowRef(bridge), query: () => query(), blocked: () => false, onChange: () => {}, onError: message => { throw new Error(message); } });
      expect(await history.apply([{ address, value: 2 }])).toBe(true);
      return () => h("p", "saved");
    }
  });
  expect(await renderToString(createSSRApp(Request))).toContain("saved");
  expect(await renderToString(createSSRApp(Request))).toContain("saved");
  expect(save.mock.calls.map(([input]) => [input.expectedRevision, input.sourceToken])).toEqual([["v1", "t1"], ["v1", "t1"]]);
});
