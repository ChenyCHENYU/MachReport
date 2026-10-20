// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createTableTemplate, createReportSource, getReportCellContext, getReportEditSession, type RenderPlan, type ReportCellContext, type ReportEditBatch } from "../../index";
import ReportPreview from "../ReportPreview.vue";
import type { MachReportController } from "../controller";
import type { ReportEditingOptions } from "../editing";
const mounted = new Set<VueWrapper>();
afterEach(() => { mounted.forEach((wrapper) => wrapper.unmount()); mounted.clear(); document.body.replaceChildren(); vi.restoreAllMocks(); });
function fixture() {
  const template = createTableTemplate({ layout: "wide", title: "Calculated report", columns: [
    { field: "id", header: "ID" }, { field: "qty", header: "Qty", valueType: "number" }, { field: "price", header: "Price" },
    { field: "amount", header: "Amount", rules: [{ when: { field: "amount", op: ">", value: 10 }, style: { color: "#ff0000" } }] }
  ], listOptions: { rowKey: "id", revisionField: "rev", sourceTokenField: "token", rowVisibleWhen: { field: "qty", op: ">", value: 0 }, computed: [{ field: "amount", expression: { op: "multiply", args: [{ field: "qty" }, { field: "price" }] } }], grandTotal: { fields: ["amount"] } } });
  const datasets = { detail: [{ id: "001", qty: 2, price: 3, rev: "1", token: "v1" }, { id: "002", qty: 3, price: 4, rev: "1", token: "v1" }] };
  return { template, datasets };
}
function context(plan: RenderPlan, id: string, field: string): ReportCellContext | undefined {
  for (const [pageIndex, page] of plan.pages.entries()) for (const [componentIndex, component] of page.components.entries()) {
    if (component.table?.role !== "body" || component.table.source?.rowKey !== id) continue;
    return getReportCellContext(plan, { pageIndex, componentIndex, rowIndex: 0, columnIndex: component.table.columnKeys.indexOf(field) })!;
  }
}
async function create(editable: boolean | ReportEditingOptions = true, transport = false) {
  const spec = fixture(), source = createReportSource({ A: spec });
  let queried!: RenderPlan;
  const fetcher = async (request: Parameters<typeof source>[0]) => {
    const value = await source(request); queried = value;
    return transport ? JSON.parse(JSON.stringify(value)) as RenderPlan : value;
  };
  const onError = vi.fn();
  const wrapper = mount(ReportPreview, { props: { reportId: "A", fetcher, editable, onError, guardChanges: false }, attachTo: document.body });
  mounted.add(wrapper); await vi.waitFor(() => expect(wrapper.find("td").exists()).toBe(true));
  const report = wrapper.vm as unknown as Required<Pick<MachReportController, "getPlan" | "getChanges" | "getDifferences" | "focusCell" | "getSelection" | "pasteSelection" | "undo" | "redo" | "restoreChanges" | "reload" | "exportAs">>;
  async function edit(id: string, qty: number) { await report.focusCell(context(report.getPlan()!, id, "qty")!.address); return report.pasteSelection(String(qty)); }
  return { spec, wrapper, report, onError, edit, queried: () => queried };
}
describe("Vue source-backed edit/recalculate publication", () => {
  it("recalculates derived values, conditions and totals before publishing, preserving caller datasets", async () => {
    const { report, edit, spec, wrapper } = await create();
    expect(await edit("001", 5)).toBe(true);
    const plan = report.getPlan()!;
    expect(context(plan, "001", "amount")?.value).toBe(15);
    expect(context(plan, "001", "amount")?.cell.style?.color).toBe("#ff0000");
    expect(plan.pages.flatMap((page) => page.components).find((item) => item.table?.role === "grand-total")!.grid!.cells[0]!.at(-1)?.value).toBe(27);
    expect(spec.datasets.detail[0]!.qty).toBe(2); expect(wrapper.findAll(".mrp-cell-modified")).toHaveLength(1);
    expect(await report.undo()).toBe(true); expect(context(report.getPlan()!, "001", "amount")?.value).toBe(6);
    expect(await report.redo()).toBe(true); expect(context(report.getPlan()!, "001", "amount")?.value).toBe(15);
  });
  it("undoes/redoes hidden rows by source, preserves permission hooks and never marks the replacement row", async () => {
    let allowed = true;
    const canEdit = vi.fn(() => allowed);
    const saveBatch = vi.fn((_batch: Readonly<ReportEditBatch>) => ({ revision: String(saveBatch.mock.calls.length + 1), sourceToken: `v${saveBatch.mock.calls.length + 1}` }));
    const { report, edit, wrapper } = await create({ requireSource: true, canEdit, fields: { qty: { type: "number", min: 0, max: 10 } }, saveBatch });
    expect(await edit("001", 0)).toBe(true);
    expect(context(report.getPlan()!, "001", "qty")).toBeUndefined();
    expect(wrapper.findAll(".mrp-cell-modified")).toHaveLength(0); expect(report.getSelection()).toBeNull();
    allowed = false; expect(await report.undo()).toBe(false); expect(saveBatch).toHaveBeenCalledTimes(1);
    allowed = true; expect(await report.undo()).toBe(true);
    expect(saveBatch.mock.calls[1]![0].edits[0]).toMatchObject({ value: 2, source: { rowKey: "001", revision: "2", sourceToken: "v2" } });
    expect(context(report.getPlan()!, "001", "amount")?.value).toBe(6);
    expect(await report.redo()).toBe(true); expect(context(report.getPlan()!, "001", "qty")).toBeUndefined();
    expect(await report.restoreChanges()).toBe(true); expect(context(report.getPlan()!, "001", "qty")?.value).toBe(2);
  });
  it("keeps source and session unchanged on failed save and reuses request identity on retry", async () => {
    const saveBatch = vi.fn().mockRejectedValueOnce(new Error("rejected")).mockResolvedValue({ revision: "2" });
    const { report, edit, queried } = await create({ saveBatch });
    const initial = queried(), session = getReportEditSession(initial)!;
    expect(await edit("001", 5)).toBe(false); expect(session.plan).toBe(initial);
    expect(context(report.getPlan()!, "001", "qty")?.value).toBe(2); expect(report.getChanges()).toEqual([]);
    expect(await edit("001", 5)).toBe(true);
    expect(saveBatch.mock.calls[0]![0].requestId).toBe(saveBatch.mock.calls[1]![0].requestId);
    expect(context(report.getPlan()!, "001", "amount")?.value).toBe(15);
  });
  it("waits for a pending paste save before exporting and uses the recomputed result", async () => {
    let finish!: () => void;
    const saveBatch = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { report, edit } = await create({ saveBatch });
    const xlsx = await import("../../xlsx/render-xlsx");
    const encode = vi.spyOn(xlsx, "renderPlanToXlsx").mockResolvedValue({ workbook: {} as Awaited<ReturnType<typeof xlsx.renderPlanToXlsx>>["workbook"], buffer: new ArrayBuffer(0), warnings: [] });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recomputed"); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const editing = edit("001", 5); await vi.waitFor(() => expect(saveBatch).toHaveBeenCalledOnce());
    const exporting = report.exportAs("xlsx"); await flushPromises(); expect(encode).not.toHaveBeenCalled();
    finish(); expect(await editing).toBe(true); await exporting;
    expect(encode).toHaveBeenCalledOnce(); expect(context(encode.mock.calls[0]![0], "001", "amount")?.value).toBe(15);
  });
  it("rejects transported calculation plans with a configurable explanation and keeps ordinary raw plans compatible", async () => {
    const { wrapper, report, onError } = await create(true, true);
    await wrapper.setProps({ messages: { editRecalculationUnavailable: "Reload the source-backed template" } });
    const qty = context(report.getPlan()!, "001", "qty")!;
    await wrapper.find(`[data-mr-component-index="${qty.address.componentIndex}"] td[data-mr-column-index="1"]`).trigger("dblclick");
    expect(wrapper.find(".mrp-cell-editor").exists()).toBe(false); expect(onError).toHaveBeenCalledWith("Reload the source-backed template", expect.objectContaining({ code: "edit" }));
    await report.focusCell(qty.address); expect(await report.pasteSelection("8")).toBe(false); expect(context(report.getPlan()!, "001", "qty")?.value).toBe(2);
  });
  it("does not publish or export a late save after query replacement cancels its recalculation transaction", async () => {
    let finish!: () => void;
    const saveBatch = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { report, edit, queried } = await create({ saveBatch });
    const initial = queried(), session = getReportEditSession(initial)!;
    const editing = edit("001", 5); await vi.waitFor(() => expect(saveBatch).toHaveBeenCalledOnce());
    const exporting = report.exportAs("html"); await report.reload(); finish();
    expect(await editing).toBe(false); await exporting;
    expect(session.plan).toBe(initial); expect(context(report.getPlan()!, "001", "qty")?.value).toBe(2); expect(report.getChanges()).toEqual([]);
  });
});
