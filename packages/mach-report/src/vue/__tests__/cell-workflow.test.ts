// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { RenderPlan, ReportCellAddress, ReportEditBatch } from "@agile-team/mach-report";
import ReportPreview from "../ReportPreview.vue";
import type { MachReportController } from "../controller";
import type { ReportEditingOptions } from "../editing";
import type { ReportPreferencesOptions } from "../tools";
const mounted = new Set<VueWrapper>();
afterEach(() => { mounted.forEach((wrapper) => wrapper.unmount()); mounted.clear(); document.body.replaceChildren(); vi.restoreAllMocks(); });
function plan(): RenderPlan {
  return { schemaVersion: "workflow", pages: [{ layout: "wide", pageWidthMm: 400, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 10, topMm: 10, widthMm: 200, heightMm: 20, grid: { rowHeightsMm: [10, 10], colWidthsMm: [50, 50, 50, 50], cells: [
    [{ value: 2, text: "2", source: { datasetId: "orders", rowKey: "R1", field: "qty", revision: 1 }, valueType: "number" }, { value: "001", text: "001" }, { value: 4, text: "4", formula: "A1*2" }, { value: "fixed", text: "fixed", editable: false }],
    [{ value: 3, text: "3", valueType: "number" }, { value: "002", text: "002" }, { value: 6, text: "6" }, { value: "", text: "" }]
  ] } }] }] };
}
const address = (rowIndex = 0, columnIndex = 0): ReportCellAddress => ({ pageIndex: 0, componentIndex: 0, rowIndex, columnIndex });
function api(wrapper: VueWrapper): Required<Pick<MachReportController, "getPlan" | "getChanges" | "getDifferences" | "undo" | "redo" | "restoreChanges" | "focusCell" | "focusField" | "getSelection" | "copySelection" | "pasteSelection">> { return wrapper.vm as never; }
async function create(editable: boolean | ReportEditingOptions = true, preferences?: ReportPreferencesOptions, original = plan()) {
  const fetcher = vi.fn().mockResolvedValue(original);
  const wrapper = mount(ReportPreview, { props: { reportId: "workflow", fetcher, editable, preferences, showExport: false, showPdfWindow: false }, attachTo: document.body });
  mounted.add(wrapper);
  await vi.waitFor(() => expect(wrapper.find("td").exists()).toBe(true));
  return { wrapper, api: api(wrapper), original, fetcher };
}
describe("spreadsheet interactions", () => {
  it("waits for the active edit before opening settings and keeps focus on a rejected save", async () => {
    let reject!: (cause: Error) => void;
    const save = vi.fn(() => new Promise<void>((_resolve, rejectSave) => { reject = rejectSave; }));
    const { wrapper } = await create({ save });
    await wrapper.find("td").trigger("dblclick");
    await flushPromises();
    const input = wrapper.find<HTMLTextAreaElement>(".mrp-cell-editor");
    await input.setValue("8");
    await wrapper.find(".mrp-settings-toggle").trigger("click");
    expect(save).toHaveBeenCalledOnce();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    reject(new Error("保存失败，请修正"));
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(input.element);
    expect(input.attributes("aria-invalid")).toBe("true");
  });
  it("opens settings only after a pending edit has saved", async () => {
    let complete!: () => void;
    const save = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const { wrapper } = await create({ save });
    await wrapper.find("td").trigger("dblclick");
    await flushPromises();
    await wrapper.find(".mrp-cell-editor").setValue("8");
    await wrapper.find(".mrp-settings-toggle").trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    complete();
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(document.activeElement).toBe(wrapper.find(".mrp-settings-close").element);
    expect(wrapper.find(".mrp-cell-editor").exists()).toBe(false);
  });
  it("leaves grid boundaries and preserves navigation between fragments", async () => {
    const original = plan();
    original.pages[0]!.components = [0, 1].map((rowIndex) => ({ kind: "rect", leftMm: 0, topMm: rowIndex * 10, widthMm: 100, heightMm: 10, table: { id: "orders", rowIndex, role: "body", columnKeys: ["qty", "code"] }, grid: { cells: [[{ text: String(rowIndex) }, { text: "code" }]] } }));
    const { wrapper, api: report } = await create(false, undefined, original);
    const viewport = wrapper.find(".mrp-body").element;
    await report.focusCell(address(0, 1));
    const nextFragment = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    viewport.dispatchEvent(nextFragment);
    await flushPromises();
    expect(nextFragment.defaultPrevented).toBe(true);
    expect(report.getSelection()?.focus).toEqual({ ...address(), componentIndex: 1 });
    await report.focusCell({ ...address(0, 1), componentIndex: 1 });
    const leave = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    viewport.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);
    await report.focusCell(address());
    const previous = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    viewport.dispatchEvent(previous);
    expect(previous.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(viewport);
  });
  it("ignores non-text and empty native paste without clearing business values", async () => {
    const saveBatch = vi.fn();
    const { wrapper, api: report, original } = await create({ saveBatch });
    await report.focusCell(address());
    for (const types of [["image/png"], ["text/plain"]]) {
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: { types, getData: () => "" } });
      wrapper.find(".mrp-body").element.dispatchEvent(paste);
      await flushPromises();
      expect(paste.defaultPrevented).toBe(false);
      expect(report.getPlan()).toEqual(original);
      expect(report.getChanges()).toEqual([]);
    }
    expect(saveBatch).not.toHaveBeenCalled();
  });
  it("keeps header semantics after selection refresh", async () => {
    const original = plan();
    original.pages[0]!.components[0]!.table = { id: "header", role: "header", rowIndex: -1, columnKeys: ["qty", "code", "formula", "note"] };
    const { wrapper, api: report } = await create(false, undefined, original);
    await report.focusCell(address());
    expect(wrapper.findAll('[role="columnheader"]')).toHaveLength(8);
    expect(wrapper.findAll('[role="gridcell"]')).toHaveLength(0);
  });
  it("selects, extends with Shift, navigates by keyboard and copies an exact rectangular TSV", async () => {
    const { wrapper, api: report } = await create();
    await wrapper.find('td[data-mr-row-index="0"][data-mr-column-index="0"]').trigger("click");
    await wrapper.find(".mrp-body").trigger("keydown", { key: "ArrowRight", shiftKey: true });
    await flushPromises();
    expect(wrapper.findAll(".mrp-cell-selected")).toHaveLength(2);
    expect(report.copySelection()).toBe("2\t001");
    await wrapper.find(".mrp-body").trigger("keydown", { key: "ArrowDown" });
    await flushPromises();
    expect(report.getSelection()?.focus).toEqual(address(1, 1));
    expect(wrapper.find(".mrp-cell-focus").attributes("tabindex")).toBe("0");
    expect(await report.focusField({ datasetId: "orders", rowKey: "R1", field: "qty" })).toBe(true);
    expect(report.getSelection()?.focus).toEqual(address());
  });
  it("prevalidates every pasted cell, including read-only cells, before save or local application", async () => {
    const saveBatch = vi.fn();
    const { wrapper, api: report, original } = await create({ saveBatch });
    await report.focusCell(address());
    expect(await report.pasteSelection("8\t0008\r\ninvalid\t0009")).toBe(false);
    expect(saveBatch).not.toHaveBeenCalled();
    expect(report.getChanges()).toEqual([]);
    expect(await report.pasteSelection("8\t0008\t20")).toBe(false);
    expect(saveBatch).not.toHaveBeenCalled();
    expect(report.getPlan()).toEqual(original);
    expect(wrapper.find(".mrp-export-error").exists()).toBe(true);
  });
  it("uses one atomic callback with request identity, advances revisions, and persists undo/redo/restore", async () => {
    let revision = 1;
    const saveBatch = vi.fn((_batch: Readonly<ReportEditBatch>) => ({ revision: ++revision, sourceToken: `token-${revision}` }));
    const { wrapper, api: report, original } = await create({ saveBatch });
    await report.focusCell(address());
    expect(await report.pasteSelection("8\t0008\r\n9\t0009")).toBe(true);
    const [batch, operation] = saveBatch.mock.calls[0]! as unknown as [ReportEditBatch, { requestId: string; action: string }];
    expect(batch.edits).toHaveLength(4);
    expect(batch.requestId).toBe(operation.requestId);
    expect(operation.action).toBe("edit");
    expect(batch.edits[0]?.source?.rowKey).toBe("R1");
    expect(wrapper.findAll(".mrp-cell-modified")).toHaveLength(4);
    expect(await report.undo()).toBe(true);
    expect(saveBatch.mock.calls.at(-1)?.[0].edits[0]?.source?.revision).toBe(2);
    expect(report.getDifferences()).toEqual([]);
    expect(await report.redo()).toBe(true);
    expect(report.getDifferences()).toHaveLength(4);
    expect(await report.restoreChanges()).toBe(true);
    expect(report.getDifferences()).toEqual([]);
    expect(original.pages[0]!.components[0]!.grid!.cells[0]![0]?.value).toBe(2);
  });
  it("never emulates a multi-cell server transaction through sequential single-save calls", async () => {
    const save = vi.fn();
    const { wrapper, api: report } = await create({ save });
    await report.focusCell(address());
    expect(await report.pasteSelection("8\t0008")).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("原子 saveBatch");
    expect(report.getChanges()).toEqual([]);
  });
  it("shows conflicts and retains plan/history when persistence rejects undo", async () => {
    const saveBatch = vi.fn().mockResolvedValueOnce({ revision: 2 }).mockResolvedValueOnce({ conflicts: [{ source: { datasetId: "orders", rowKey: "R1", field: "qty" }, message: "版本已变化，请刷新后重试", currentValue: 12 }] });
    const { wrapper, api: report } = await create({ saveBatch });
    await report.focusCell(address());
    expect(await report.pasteSelection("8")).toBe(true);
    expect(await report.undo()).toBe(false);
    expect(report.getDifferences()).toHaveLength(1);
    expect(report.getPlan()!.pages[0]!.components[0]!.grid!.cells[0]![0]?.value).toBe(8);
    expect(wrapper.text()).toContain("版本已变化");
    expect(wrapper.find(".mrp-conflicts").exists()).toBe(true);
  });
  it("aborts a pending batch on reload and ignores its late success", async () => {
    let complete!: () => void;
    let signal!: AbortSignal;
    const saveBatch = vi.fn((_batch, operation) => { signal = operation.signal; return new Promise<void>((resolve) => { complete = resolve; }); });
    const { wrapper, api: report } = await create({ saveBatch });
    await report.focusCell(address());
    const pending = report.pasteSelection("8\t0008");
    await vi.waitFor(() => expect(saveBatch).toHaveBeenCalledOnce());
    await (wrapper.vm as unknown as MachReportController).reload();
    expect(signal.aborted).toBe(true);
    complete();
    expect(await pending).toBe(false);
    expect(report.getChanges()).toEqual([]);
  });
  it("supports batch paste and range copy across logical table fragments without using indices as business IDs", async () => {
    const original = plan();
    original.pages[0]!.components = ["R1", "R2"].map((rowKey, rowIndex) => ({ kind: "rect", leftMm: 0, topMm: rowIndex * 10, widthMm: 100, heightMm: 10, table: { id: "orders", rowIndex, role: "body", columnKeys: ["qty", "code"], source: { datasetId: "orders", rowKey, revision: 1 } }, grid: { cells: [[{ value: rowIndex + 1, text: String(rowIndex + 1), valueType: "number" }, { value: `00${rowIndex + 1}`, text: `00${rowIndex + 1}` }]] } }));
    const saveBatch = vi.fn();
    const { wrapper, api: report } = await create({ saveBatch, requireSource: true }, undefined, original);
    await report.focusCell(address());
    await report.focusCell({ ...address(0, 1), componentIndex: 1 }, true);
    expect(report.copySelection()).toBe("1\t001\r\n2\t002");
    expect(await report.pasteSelection("8\t008\r\n9\t009")).toBe(true);
    expect(saveBatch.mock.calls[0]![0].edits.map((edit: { source: { rowKey: string } }) => edit.source.rowKey)).toEqual(["R1", "R1", "R2", "R2"]);
    expect(wrapper.findAll(".mrp-cell-modified")).toHaveLength(4);
  });
  it("keeps multi-row repeated headers separate from body coordinates during copy, paste and cross-page selection", async () => {
    const original: RenderPlan = { schemaVersion: "multi-header", pages: [0, 1].map((rowIndex) => ({ layout: "wide", pageWidthMm: 200, pageHeightMm: 70, components: [
      { kind: "rect", leftMm: 0, topMm: 0, widthMm: 100, heightMm: 20, table: { id: "orders", role: "header", rowIndex: -1, columnKeys: ["qty", "code"] }, grid: { colWidthsMm: [50, 50], cells: [[{ text: "订单明细", colSpan: 2 }], [{ text: "数量" }, { text: "编号" }]] } },
      { kind: "rect", leftMm: 0, topMm: 20, widthMm: 100, heightMm: 10, table: { id: "orders", role: "body", rowIndex, columnKeys: ["qty", "code"], source: { datasetId: "orders", rowKey: `R${rowIndex + 1}` } }, grid: { cells: [[{ value: rowIndex + 1, text: String(rowIndex + 1), valueType: "number" }, { value: `00${rowIndex + 1}`, text: `00${rowIndex + 1}` }]] } }
    ] })) };
    const saveBatch = vi.fn();
    const { wrapper, api: report } = await create({ saveBatch, requireSource: true }, undefined, original);
    const firstBody = { ...address(), componentIndex: 1 };
    const secondBody = { ...firstBody, pageIndex: 1, columnIndex: 1 };
    await report.focusCell(firstBody);
    await report.focusCell(secondBody, true);
    expect(report.copySelection()).toBe("1\t001\r\n2\t002");
    expect(await report.pasteSelection("8\t008\r\n9\t009")).toBe(true);
    expect(saveBatch.mock.calls[0]![0].edits.map((edit: { source: { rowKey: string } }) => edit.source.rowKey)).toEqual(["R1", "R1", "R2", "R2"]);
    await report.focusCell(address(1, 0));
    await report.focusCell({ ...firstBody, columnIndex: 1 }, true);
    expect(report.copySelection()).toBe("数量\t编号\r\n8\t008");
    await report.focusCell(firstBody);
    await wrapper.find(".mrp-body").trigger("keydown", { key: "ArrowDown", shiftKey: true });
    await flushPromises();
    expect(report.getSelection()?.focus).toEqual({ ...secondBody, columnIndex: 0 });
    expect(report.copySelection()).toBe("8\r\n9");
  });
  it("loads opt-in preferences safely, preserves host capability limits and serializes adapter writes", async () => {
    const save = vi.fn();
    const load = vi.fn().mockResolvedValue({ search: false, editing: true, import: true });
    const { wrapper } = await create(false, { key: "tenant:user:report", adapter: { load, save } });
    await flushPromises();
    expect(wrapper.find(".mrp-search-toggle").exists()).toBe(false);
    expect(wrapper.find(".mrp-import-excel").exists()).toBe(false);
    await wrapper.find(".mrp-settings-toggle").trigger("click");
    await flushPromises();
    await wrapper.find('[role="tab"][id$="-tools"]').trigger("click");
    const option = wrapper.findAll("label.mrp-settings-option").find((label) => label.text().includes("内容搜索"))!;
    await option.find("input").setValue(true);
    await flushPromises();
    expect(save).toHaveBeenCalledWith("tenant:user:report", { search: true, editing: true, import: true });
    expect(wrapper.text()).toContain("需由接入方配置启用");
  });
  it("does not let late preference hydration replace a user's newer choice and ignores stale keys", async () => {
    let resolve!: (value: { search: boolean }) => void;
    const load = vi.fn(() => new Promise<{ search: boolean }>((done) => { resolve = done; }));
    const save = vi.fn();
    const { wrapper } = await create(false, { key: "first", adapter: { load, save } });
    await wrapper.find(".mrp-settings-toggle").trigger("click");
    await wrapper.find('[role="tab"][id$="-tools"]').trigger("click");
    const search = wrapper.findAll("label.mrp-settings-option").find((label) => label.text().includes("内容搜索"))!.find("input");
    await search.setValue(false);
    resolve({ search: true });
    await flushPromises();
    expect((search.element as HTMLInputElement).checked).toBe(false);
    await wrapper.setProps({ preferences: { key: "second", adapter: { load: async () => ({ search: true }), save } } });
    await flushPromises();
    expect((search.element as HTMLInputElement).checked).toBe(true);
  });
  it("keeps settings usable when adapter storage fails and reports the failure once", async () => {
    const { wrapper } = await create(false, { key: "blocked", adapter: { load: async () => { throw new Error("blocked"); }, save: () => { throw new Error("blocked"); } } });
    await flushPromises();
    expect(wrapper.emitted("warning")?.some(([message]) => String(message).includes("偏好存储不可用"))).toBe(true);
    await wrapper.find(".mrp-settings-toggle").trigger("click");
    await wrapper.find('[role="tab"][id$="-tools"]').trigger("click");
    const search = wrapper.findAll("label.mrp-settings-option").find((label) => label.text().includes("内容搜索"))!.find("input");
    await search.setValue(false);
    await flushPromises();
    expect((search.element as HTMLInputElement).checked).toBe(false);
  });
  it("rejects malformed, oversized and out-of-grid clipboard data without touching the report", async () => {
    const { wrapper, api: report, original } = await create();
    await report.focusCell(address());
    expect(await report.pasteSelection('"unclosed')).toBe(false);
    expect(wrapper.text()).toContain("剪贴板内容无法识别");
    expect(await report.pasteSelection("8\t9\t10\t11\t12")).toBe(false);
    expect(await report.pasteSelection(Array.from({ length: 10001 }, () => "1").join("\t"))).toBe(false);
    expect(wrapper.text()).toContain("10000");
    expect(report.getPlan()).toEqual(original);
  });
  it("disabling editing while a batch is validating aborts it before persistence", async () => {
    let finish!: () => void;
    const validate = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const saveBatch = vi.fn();
    const { wrapper, api: report } = await create({ validate, saveBatch });
    await report.focusCell(address());
    const pending = report.pasteSelection("8\t0008");
    await vi.waitFor(() => expect(validate).toHaveBeenCalledOnce());
    await wrapper.setProps({ editable: false });
    finish();
    expect(await pending).toBe(false);
    expect(saveBatch).not.toHaveBeenCalled();
    expect(report.getChanges()).toEqual([]);
  });
  it("reuses the idempotency identity for an unchanged failed batch retry", async () => {
    const saveBatch = vi.fn().mockRejectedValueOnce(new Error("network timeout")).mockResolvedValueOnce({ revision: 2 });
    const { api: report } = await create({ saveBatch });
    await report.focusCell(address());
    expect(await report.pasteSelection("8\t0008")).toBe(false);
    expect(await report.pasteSelection("8\t0008")).toBe(true);
    expect(saveBatch.mock.calls[0]![0].requestId).toBe(saveBatch.mock.calls[1]![0].requestId);
  });
  it.each(["undo", "redo", "restoreChanges"] as const)("does not repopulate history when %s cell-edit synchronously reloads a new business row", async (action) => {
    const saveBatch = vi.fn();
    const { wrapper, api: report, fetcher } = await create({ saveBatch });
    await report.focusCell(address());
    expect(await report.pasteSelection("8")).toBe(true);
    if (action === "redo") expect(await report.undo()).toBe(true);
    const replacement = plan();
    replacement.pages[0]!.components[0]!.grid!.cells[0]![0] = { value: 100, text: "100", source: { datasetId: "orders", rowKey: "NEW", field: "qty", revision: 8 } };
    fetcher.mockResolvedValue(replacement);
    await wrapper.setProps({ guardChanges: false });
    const onEdit = vi.fn(() => { void (wrapper.vm as unknown as MachReportController).reload(); });
    await wrapper.setProps({ "onCell-edit": onEdit });
    expect(await report[action]()).toBe(false);
    await vi.waitFor(() => expect(report.getPlan()?.pages[0]!.components[0]!.grid!.cells[0]![0]?.value).toBe(100));
    expect((wrapper.vm as unknown as MachReportController).state?.canRedo).toBe(false);
    expect((wrapper.vm as unknown as MachReportController).state?.canUndo).toBe(false);
    expect(await report.redo()).toBe(false);
    expect(await report.undo()).toBe(false);
    expect(report.getDifferences()).toEqual([]);
    expect(saveBatch.mock.calls.flatMap(([batch]) => batch.edits).some((edit) => edit.source?.rowKey === "NEW")).toBe(false);
  });
  it("stops emitting the remaining old batch when a cell-edit callback replaces the report", async () => {
    const { wrapper, api: report, fetcher } = await create();
    await wrapper.setProps({ guardChanges: false });
    const onEdit = vi.fn(() => { void (wrapper.vm as unknown as MachReportController).reload(); });
    fetcher.mockResolvedValue(plan());
    await wrapper.setProps({ "onCell-edit": onEdit });
    await report.focusCell(address());
    expect(await report.pasteSelection("8\t008")).toBe(false);
    expect(onEdit).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(report.getPlan()).not.toBeNull());
    expect(report.getChanges()).toEqual([]);
  });
  it("keeps the editor focused when pointer selection and double-click happen in the same update", async () => {
    const { wrapper } = await create();
    const cell = wrapper.find('td[data-mr-row-index="0"][data-mr-column-index="1"]').element;
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await vi.waitFor(() => expect(wrapper.find("textarea.mrp-cell-editor").exists()).toBe(true));
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.find("textarea.mrp-cell-editor").element);
    expect((document.activeElement as HTMLTextAreaElement).value).toBe("001");
  });
  it("preserves the searched mark node between pointer clicks so native dblclick targets stay connected", async () => {
    const { wrapper } = await create();
    await wrapper.find('button[aria-label="内容搜索"]').trigger("click");
    await wrapper.find(".mrp-search-input").setValue("001");
    await vi.waitFor(() => expect(wrapper.find("mark.mrp-hit").exists()).toBe(true));
    const mark = wrapper.find("mark.mrp-hit").element;
    mark.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(mark.isConnected).toBe(true);
    expect(wrapper.find("mark.mrp-hit").element).toBe(mark);
    mark.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
    mark.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
    await vi.waitFor(() => expect(wrapper.find("textarea.mrp-cell-editor").exists()).toBe(true));
  });
});
