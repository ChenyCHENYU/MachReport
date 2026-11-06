// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createReportSource, createTableTemplate, createReportCellEditBatch, type RenderPlan, type ReportProvider, type ReportQueryResult, type ReportLoadContext } from "../../index";
import { createConflictReview } from "../edit-conflict-review";
import { createProviderEditing } from "../provider-editing";
import ReportPreview from "../ReportPreview.vue";
import type { MachReportController } from "../controller";
const wrappers = new Set<VueWrapper>();
afterEach(() => { wrappers.forEach(w => w.unmount()); wrappers.clear(); document.body.replaceChildren(); vi.restoreAllMocks(); });
function plan(value: string | number | null = 1, rowKey: string | number = 0): RenderPlan {
  return { schemaVersion: "test", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 80, heightMm: 10,
    table: { id: "list", role: "body", rowIndex: 0, columnKeys: ["qty"], source: { datasetId: "detail", rowKey, revision: "r1", sourceToken: "t1" } }, grid: { cells: [[{ text: String(value ?? ""), value }]] } }] }] };
}
const address = { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 };
describe("typed business conflict comparison", () => {
  it("chooses unchanged fields locally, recognizes already saved values and requires decisions for real conflicts", () => {
    const edits = createReportCellEditBatch(plan(), [{ address, value: 3 }], "req").edits;
    expect(createConflictReview(plan(), edits)[0]).toMatchObject({ choice: "local", latestValue: 1 });
    expect(createConflictReview(plan(3), edits)[0]).toMatchObject({ choice: "server", latestValue: 3 });
    expect(createConflictReview(plan(2), edits)[0]).toMatchObject({ choice: null, latestValue: 2 });
    expect(createConflictReview(plan("1"), edits)[0]).toMatchObject({ choice: null, latestValue: "1" });
  });
  it("does not match string row zero to numeric zero, missing sources or another query occurrence", () => {
    const edits = createReportCellEditBatch(plan(), [{ address, value: 3 }], "req").edits;
    expect(createConflictReview(plan(1, "0"), edits)[0]?.availability).toBe("missing");
    const raw = structuredClone(edits); delete raw[0]!.source;
    expect(createConflictReview(plan(), raw)[0]?.availability).toBe("missing");
    const scoped = plan(); scoped.pages[0]!.components[0]!.table!.source!.sourceScope = "different";
    expect(createConflictReview(scoped, edits)[0]?.availability).toBe("missing");
  });
  it.each(["value", "revision", "sourceToken", "readonly"])("marks disagreeing mirrors as ambiguous (%s)", kind => {
    const edits = createReportCellEditBatch(plan(), [{ address, value: 3 }], "req").edits;
    const latest = plan(), mirror = structuredClone(latest.pages[0]!.components[0]!);
    if (kind === "value") mirror.grid!.cells[0]![0]!.value = 9;
    if (kind === "revision") mirror.table!.source!.revision = "r2";
    if (kind === "sourceToken") mirror.table!.source!.sourceToken = "t2";
    if (kind === "readonly") mirror.grid!.cells[0]![0]!.editable = false;
    latest.pages[0]!.components.push(mirror);
    expect(createConflictReview(latest, edits)[0]).toMatchObject({ availability: "ambiguous", choice: null });
  });
  it("keeps readonly and missing fields visible for an explicit server decision", () => {
    const edits = createReportCellEditBatch(plan(), [{ address, value: 3 }], "req").edits;
    const latest = plan(); latest.pages[0]!.components[0]!.grid!.cells[0]![0]!.editable = false;
    expect(createConflictReview(latest, edits)[0]).toMatchObject({ availability: "readonly", choice: null });
    expect(() => createConflictReview(latest, Array(10001).fill(edits[0]))).toThrow(/limit/);
  });
});
async function fixture() {
  let revision = 1;
  const query = vi.fn((_input: ReportLoadContext): ReportQueryResult => ({ datasets: { detail: [{ id: 0, input: revision === 1 ? 10 : 100, output: 2 }] }, revision: `r${revision}`, sourceToken: `t${revision}` }));
  const save = vi.fn<NonNullable<ReportProvider["save"]>>().mockResolvedValueOnce({ revision: "r2", conflicts: [{ editIndex: 0, code: "stale", message: "并发修改" }] }).mockResolvedValue({ revision: "r3", sourceToken: "t3" });
  const provider: ReportProvider = { query, save };
  const template = createTableTemplate({ layout: "wide", columns: [{ field: "id", header: "编号" }, { field: "input", header: "投料", valueType: "number" }, { field: "output", header: "产出", valueType: "number" }, { field: "loss", header: "损耗" }], listOptions: { rowKey: "id", computed: [{ field: "loss", expression: { op: "subtract", args: [{ field: "input" }, { field: "output" }] } }] } });
  const editable = createProviderEditing(provider, { validation: { rules: [{ id: "bounds", field: "output", assert: { field: "output", op: "<=", right: { field: "input" }, valueType: "number" }, message: "产出超限" }] } });
  const wrapper = mount(ReportPreview, { attachTo: document.body, props: { reportId: "daily", params: { date: "2026-11-01" }, editable, fetcher: createReportSource({ daily: { template, provider } }), height: "500px", autoLoad: false, showExport: false, showPdfWindow: false } });
  wrappers.add(wrapper); const report = wrapper.vm as unknown as MachReportController;
  await report.reload();
  const body = report.getPlan!()!.pages[0]!.components.findIndex(c => c.table?.role === "body");
  await report.focusCell!({ ...address, componentIndex: body, columnIndex: 1 });
  expect(await report.pasteSelection!("12\t3")).toBe(false);
  revision = 2;
  const reviewButton = () => wrapper.findAll("button").find(b => b.text().includes("核对保存冲突"))!;
  async function open() { await reviewButton().trigger("click"); await vi.waitFor(() => expect(wrapper.findAll(".mrp-conflict-rows li")).toHaveLength(2)); }
  return { wrapper, report, query, save, open, reviewButton };
}
describe("preview conflict recovery transaction", () => {
  it("keeps the old display until a choice, then validates and atomically saves fresh values with the accepted query", async () => {
    const f = await fixture(), original = f.report.getPlan!();
    expect(f.report.state!.pendingLocalChanges).toBe(true);
    // An unsubmitted form must never change the target of the displayed report's save/requery.
    await f.report.setParams({ date: "2026-12-01" }, { reload: false });
    await f.open();
    expect(f.report.getPlan!()).toEqual(original);
    expect(f.query.mock.calls[1]?.[0]).toMatchObject({ params: { date: "2026-11-01" } });
    const rows = f.wrapper.findAll(".mrp-conflict-rows li");
    expect(rows[0]!.text()).toContain("100");
    await rows[0]!.get('input[value="server"]').setValue();
    const apply = f.wrapper.get(".mrp-conflict-submit"); expect(apply.attributes("disabled")).toBeUndefined();
    await apply.trigger("click"); await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(f.wrapper.find(".mrp-conflict-review").exists()).toBe(false));
    expect(f.save.mock.calls[1]![0]).toMatchObject({ params: { date: "2026-11-01" }, expectedRevision: "r2", sourceToken: "t2", edits: [{ source: { rowKey: 0, field: "output" }, previousValue: 2, value: 3 }] });
    expect(f.save.mock.calls[1]![0].edits).toHaveLength(1);
    expect(f.save.mock.calls[1]![0].requestId).not.toBe(f.save.mock.calls[0]![0].requestId);
    const cells = f.report.getPlan!()!.pages.flatMap(p => p.components.flatMap(c => c.grid?.cells.flat().map(x => x?.value) ?? []));
    expect(cells).toContain(97); expect(f.report.state!.pendingLocalChanges).toBe(false);
  });
  it("retains the chosen local batch after a second CAS conflict and re-reads before another attempt", async () => {
    const f = await fixture();
    f.save.mockResolvedValueOnce({ revision: "r4", conflicts: [{ editIndex: 0, code: "again", message: "再次冲突" }] });
    await f.open(); await f.wrapper.findAll(".mrp-conflict-rows li")[0]!.get('input[value="local"]').setValue();
    await f.wrapper.get(".mrp-conflict-submit").trigger("click");
    await vi.waitFor(() => expect(f.wrapper.find(".mrp-conflict-error").text()).toContain("再次冲突"));
    expect(f.report.state!.pendingLocalChanges).toBe(true);
    expect(f.wrapper.get(".mrp-conflict-submit").attributes("disabled")).toBeDefined();
    await f.wrapper.findAll(".mrp-conflict-actions button")[0]!.trigger("click");
    await vi.waitFor(() => expect(f.query).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(f.wrapper.findAll(".mrp-conflict-rows li")).toHaveLength(2));
    expect(f.report.state!.pendingLocalChanges).toBe(true);
  });
  it("keeps the whole rejected paste protected even after the editor is gone and closing review", async () => {
    const f = await fixture();
    expect(f.report.state!.pendingLocalChanges).toBe(true); await f.open();
    await f.wrapper.get('.mrp-review-dialog>header button').trigger("click");
    expect(f.wrapper.find(".mrp-conflict-review").exists()).toBe(false);
    expect(f.report.state!.pendingLocalChanges).toBe(true);
    expect(f.report.getDifferences!()).toEqual([]);
    const checking = f.report.confirmDiscard!("reload");
    await vi.waitFor(() => expect(f.wrapper.find(".mrp-discard-dialog").exists()).toBe(true));
    await f.wrapper.findAll(".mrp-discard-dialog button")[0]!.trigger("click");
    expect(await checking).toBe(false); expect(f.save).toHaveBeenCalledOnce();
  });
  it("failed latest query leaves the original plan and pending edits available to retry", async () => {
    const f = await fixture(), original = f.report.getPlan!();
    f.query.mockImplementationOnce(() => { throw new Error("查询失败"); });
    await f.reviewButton().trigger("click");
    await vi.waitFor(() => expect(f.wrapper.find(".mrp-conflict-error").text()).toContain("查询失败"));
    expect(f.report.getPlan!()).toEqual(original); expect(f.report.state!.pendingLocalChanges).toBe(true);
    expect(f.save).toHaveBeenCalledOnce();
  });
});
