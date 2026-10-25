// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ReportPreview from "../ReportPreview.vue";
import { createReportSource } from "../../source/report-source";
import { createTableTemplate } from "../../builder/table-template";
import type { RenderPlan } from "../../schema/render-plan";
import type { ReportEditingOptions } from "../editing";
import type { ReportPrefillReviewOptions } from "../data-review";
import type { MachReportController } from "../controller";
import { defineMachReportConfig, provideMachReportConfig } from "../config";
import { defineComponent, h, shallowRef } from "vue";
const mounted = new Set<VueWrapper>();
afterEach(() => { for (const wrapper of mounted) wrapper.unmount(); mounted.clear(); document.body.replaceChildren(); });
function plan(): RenderPlan { return { schemaVersion: "test", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 60, heightMm: 10, grid: { colWidthsMm: [30, 30], cells: [[{ value: null, valueType: "number", text: "", source: { datasetId: "production", rowKey: "A", field: "qty", revision: 1 } }, { value: "", text: "", source: { datasetId: "production", rowKey: "A", field: "note", revision: 1 } }]] } }] }] }; }
const prefill: ReportPrefillReviewOptions = { datasetId: "production", fields: [{ field: "qty" }, { field: "note" }], load: () => [{ rowKey: "A", values: { qty: 0, note: "reused" } }] };
async function mountPreview(extra: object = {}) {
  const wrapper = mount(ReportPreview, { props: { reportId: "production", fetcher: vi.fn().mockResolvedValue(plan()), showExport: false, showPrint: false, showPdfWindow: false, ...extra }, attachTo: document.body }); mounted.add(wrapper);
  await vi.waitFor(() => expect(wrapper.findAll("td[data-mr-row-index]")).toHaveLength(2)); return wrapper;
}
async function open(wrapper: VueWrapper, tool: string): Promise<void> { await wrapper.get(".mrp-data-tools-trigger").trigger("click"); await wrapper.get(`[data-review-tool="${tool}"]`).trigger("click"); await flushPromises(); }
describe("real ReportPreview optional data review entry", () => {
  it("keeps the default toolbar compact and shows a single data menu only with configured loaders", async () => {
    const wrapper = await mountPreview(); expect(wrapper.find(".mrp-data-tools").exists()).toBe(false);
    await wrapper.setProps({ prefill }); expect(wrapper.findAll(".mrp-data-tools-trigger")).toHaveLength(1);
    await open(wrapper, "prefill"); expect(wrapper.get('[role="dialog"]').attributes("aria-label")).toBe("安全预填");
    await wrapper.get(".mrp-review-heading button").trigger("click"); await flushPromises();
    expect(wrapper.get(".mrp-review-primary").attributes("disabled")).toBeDefined(); expect(wrapper.text()).toContain("只读");
  });
  it("reviews, atomically persists and exposes undo through the existing report session", async () => {
    const saveBatch = vi.fn().mockResolvedValue({ revision: 2 }), wrapper = await mountPreview({ editable: { saveBatch }, prefill });
    await open(wrapper, "prefill"); await wrapper.get(".mrp-review-heading button").trigger("click"); await flushPromises();
    expect(saveBatch).not.toHaveBeenCalled(); await wrapper.get(".mrp-review-primary").trigger("click"); await flushPromises();
    expect(saveBatch).toHaveBeenCalledOnce(); expect(saveBatch.mock.calls[0]![0].edits).toHaveLength(2);
    const controller = wrapper.vm as unknown as MachReportController; expect(controller.getPlan!()!.pages[0]!.components[0]!.grid!.cells[0]![0]!.value).toBe(0);
    expect(await controller.undo!()).toBe(true); expect(controller.getPlan!()!.pages[0]!.components[0]!.grid!.cells[0]![0]!.value).toBeNull();
  });
  it("makes the atomic persistence limitation visible before submission", async () => {
    const save = vi.fn(), wrapper = await mountPreview({ editable: { save }, prefill }); await open(wrapper, "prefill");
    await wrapper.get(".mrp-review-heading button").trigger("click"); await flushPromises(); expect(wrapper.get(".mrp-review-primary").attributes("disabled")).toBeDefined(); expect(wrapper.text()).toContain("整批"); expect(save).not.toHaveBeenCalled();
  });
  it("cancels a loader on report reload and prevents late history data from reappearing", async () => {
    let signal!: AbortSignal, resolve!: (rows: Awaited<ReturnType<ReportPrefillReviewOptions["load"]>>) => void;
    const wrapper = await mountPreview({ prefill: { ...prefill, load: (operation: { signal: AbortSignal }) => { signal = operation.signal; return new Promise(done => { resolve = done; }); } } });
    await open(wrapper, "prefill"); await wrapper.get(".mrp-review-heading button").trigger("click");
    await (wrapper.vm as unknown as MachReportController).reload!(); expect(signal.aborted).toBe(true); expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    resolve([{ rowKey: "A", values: { qty: 99 } }]); await flushPromises(); expect(wrapper.find(".mrp-review-primary").exists()).toBe(false);
  });
  it("compares the same rendered query and reveals current source cells through existing navigation", async () => {
    const wrapper = await mountPreview({ dataComparison: { datasetId: "production", fields: [{ field: "note" }], load: () => [{ rowKey: "A", values: { note: "previous" } }] } });
    await open(wrapper, "comparison"); await wrapper.get(".mrp-review-heading button").trigger("click"); await flushPromises(); expect(wrapper.text()).toContain("previous");
    await wrapper.get("tbody button").trigger("click"); await flushPromises(); expect(wrapper.find('[role="dialog"]').exists()).toBe(false); expect(wrapper.find("td[data-mr-selected]").exists() || wrapper.find("td.mrp-cell-selected").exists() || document.activeElement?.tagName === "TD").toBe(true);
  });
  it("exposes validation only for real issues and locates by stable business metadata", async () => {
    const validateBatch = vi.fn<NonNullable<ReportEditingOptions["validateBatch"]>>().mockReturnValue([{ ruleId: "weight", dataset: "production", rowKey: "A", field: "qty", severity: "error", message: "Production exceeds limit" }]);
    const wrapper = await mountPreview({ editable: { validateBatch }, prefill }); await open(wrapper, "prefill"); await wrapper.get(".mrp-review-heading button").trigger("click"); await flushPromises(); await wrapper.get(".mrp-review-primary").trigger("click"); await flushPromises();
    expect(wrapper.get('[role="dialog"]').attributes("aria-label")).toBe("数据校验"); expect(wrapper.text()).toContain("Production exceeds limit");
    await wrapper.get(".mr-validation li button").trigger("click"); await flushPromises(); expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });
  it("resolves review configuration through presets and lets a prop explicitly disable it", async () => {
    const override = shallowRef<false | undefined>();
    const wrapper = mount(defineComponent({ setup() { provideMachReportConfig(defineMachReportConfig({ defaults: { showExport: false, showPrint: false, showPdfWindow: false }, presets: { daily: { prefill } } })); return () => h(ReportPreview, { reportId: "A", preset: "daily", prefill: override.value, fetcher: vi.fn().mockResolvedValue(plan()) }); } })); mounted.add(wrapper); await flushPromises();
    expect(wrapper.find(".mrp-data-tools-trigger").exists()).toBe(true);
    override.value = false; await flushPromises(); expect(wrapper.find(".mrp-data-tools-trigger").exists()).toBe(false);
  });
  it("matches actual createReportSource shared names, preserves current values and persists scoped prefill", async () => {
    const template = createTableTemplate({ layout: "wide", columns: [{ field: "id", header: "ID", editable: false }, { field: "qty", header: "Quantity", valueType: "number", editable: true }, { field: "note", header: "Note", editable: true }], listOptions: { rowKey: "id" } });
    const fetcher = createReportSource({ production: { sourceScope: "production", template, datasets: { detail: [{ id: "A", qty: 112.4, note: "" }] } } });
    const saveBatch = vi.fn(), wrapper = mount(ReportPreview, { props: { reportId: "production", fetcher, editable: { saveBatch }, showExport: false, showPrint: false, showPdfWindow: false,
      prefill: { sourceScope: "production", datasetId: "detail", fields: [{ field: "note" }], load: () => [{ rowKey: "A", values: { note: "previous note" } }] },
      dataComparison: { sourceScope: "production", datasetId: "detail", fields: [{ field: "qty", type: "decimal" }], load: () => [{ rowKey: "A", values: { qty: 110 } }] }
    }, attachTo: document.body }); mounted.add(wrapper);
    await vi.waitFor(() => expect(wrapper.findAll("td[data-mr-row-index]").length).toBeGreaterThan(0));
    await open(wrapper, "comparison"); await wrapper.get(".mrp-review-heading button").trigger("click"); await flushPromises();
    const values = wrapper.findAll(".mrp-review-dialog tbody tr")[0]!.findAll("td").map(cell => cell.text()); expect(values).toContain("112.4"); expect(values).toContain("2.4");
    await wrapper.get('.mrp-review-dialog > header button').trigger("click"); await open(wrapper, "prefill"); await wrapper.get(".mrp-review-heading button").trigger("click"); await flushPromises();
    expect(wrapper.get(".mrp-review-primary").attributes("disabled")).toBeUndefined(); await wrapper.get(".mrp-review-primary").trigger("click"); await flushPromises();
    await vi.waitFor(() => expect(saveBatch).toHaveBeenCalledOnce()); expect(saveBatch.mock.calls[0]![0].edits[0].source).toMatchObject({ sourceScope: '["shared","production"]', datasetId: "detail", rowKey: "A", field: "note" });
    await vi.waitFor(() => expect((wrapper.vm as unknown as MachReportController).getPlan!()!.pages.flatMap(page => page.components.flatMap(component => component.grid?.cells.flatMap(row => row.map(cell => cell?.value)) ?? []))).toContain("previous note"));
  });
  it("infers a single actual createReportSource occurrence without leaking a second report scope", async () => {
    const template = createTableTemplate({ columns: [{ field: "id", header: "ID" }, { field: "qty", header: "Quantity" }], listOptions: { rowKey: "id" } });
    const fetcher = createReportSource({ production: { template, datasets: { detail: [{ id: "A", qty: 2 }] } } });
    const wrapper = mount(ReportPreview, { props: { reportId: "production", fetcher, showExport: false, showPrint: false, showPdfWindow: false,
      dataComparison: { datasetId: "detail", fields: [{ field: "qty", type: "decimal" }], load: () => [{ rowKey: "A", values: { qty: 1 } }] }
    } }); mounted.add(wrapper); await flushPromises(); await open(wrapper, "comparison"); await wrapper.get(".mrp-review-heading button").trigger("click"); await flushPromises();
    expect(wrapper.findAll(".mrp-review-dialog tbody tr")).toHaveLength(1); expect(wrapper.findAll(".mrp-review-dialog tbody tr")[0]!.findAll("td").map(cell => cell.text())).toContain("2");
  });

  it("rejects hidden or mistyped comparison fields instead of reporting all reference rows removed", async () => {
    const template = createTableTemplate({ columns: [{ field: "id", header: "ID" }, { field: "qty", header: "Quantity", hidden: true }], listOptions: { rowKey: "id" } });
    const fetcher = createReportSource({ production: { sourceScope: "production", template, datasets: { detail: [{ id: "A", qty: 112.4 }] } } });
    for (const field of ["qty", "mistypedQuantity"]) {
      const wrapper = mount(ReportPreview, { props: { reportId: "production", fetcher, showExport: false, showPrint: false, showPdfWindow: false,
        dataComparison: { sourceScope: "production", datasetId: "detail", fields: [{ field: "id" }, { field, type: "decimal" }], load: () => [{ rowKey: "A", values: { id: "A", [field]: 110 } }] }
      } }); mounted.add(wrapper); await flushPromises(); await open(wrapper, "comparison"); await wrapper.get(".mrp-review-heading button").trigger("click"); await flushPromises();
      expect(wrapper.get(".mrp-review-error").text()).toContain("not present in the current report");
      expect(wrapper.find(".mrp-review-summary").exists()).toBe(false); expect(wrapper.find(".mrp-review-dialog tbody").exists()).toBe(false);
    }
  });

});
