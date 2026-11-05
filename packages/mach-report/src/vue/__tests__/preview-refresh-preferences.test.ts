// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import type { RenderPlan } from "../../index";
import type { PlanFetcher } from "../adapters";
import ReportPreview from "../ReportPreview.vue";
import { MACH_REPORT_PDF_EXPORTER_KEY } from "../injection-keys";
import type { MachReportController } from "../controller";
import type { ReportStoredPreferences } from "../tools";

const wrappers: VueWrapper[] = [];
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount(); localStorage.clear(); vi.restoreAllMocks(); document.body.replaceChildren(); });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function plan(label: string, count = 3): RenderPlan {
  return { schemaVersion: "test", pages: Array.from({ length: count }, (_, index) => ({ pageWidthMm: 210, pageHeightMm: 200, components: [
    { kind: "text", leftMm: 5, topMm: 5, widthMm: 100, heightMm: 10, text: `${label} ${index + 1}` }
  ] })) };
}
function create(props: Record<string, unknown> = {}, provide: Record<symbol, unknown> = {}) {
  const wrapper = mount(ReportPreview, { props: { reportId: "daily", params: { plant: "A" }, showPdfWindow: false, toolbar: { exportFormats: ["html"] }, fetcher: async () => plan("initial"), ...props }, global: { provide }, attachTo: document.body });
  wrappers.push(wrapper);
  return { wrapper, controller: wrapper.vm as unknown as MachReportController };
}
async function rendered(wrapper: VueWrapper, text: string) { await vi.waitFor(() => expect(wrapper.find(".mr-page").text()).toContain(text)); }

describe("retained refresh and host-scoped view preferences", () => {
  it("retains the old snapshot during a failed refresh, blocks writes/output, and atomically accepts a retry", async () => {
    const pending = deferred<RenderPlan>();
    const fetcher = vi.fn<PlanFetcher>().mockResolvedValueOnce(plan("original")).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(plan("replacement"));
    const { wrapper, controller } = create({ fetcher, refresh: { retainPrevious: true, key: "template-v1" }, editable: true });
    await rendered(wrapper, "original");
    const loading = controller.reload(); await nextTick();
    expect(wrapper.find(".mr-page").text()).toContain("original");
    expect(controller.state).toMatchObject({ loading: true, stale: true, canExport: false, canPrint: false });
    expect(wrapper.find(".mrp-stale-snapshot").exists()).toBe(true);
    pending.reject(new Error("connection lost")); await loading; await nextTick();
    expect(controller.state).toMatchObject({ loading: false, stale: true, hasPlan: true, canExport: false });
    expect(controller.state!.params).toEqual({ plant: "A" });
    expect(wrapper.find(".mr-page").text()).toContain("original");
    expect(wrapper.find(".mrp-stale-snapshot").text()).toContain("connection lost");
    await controller.reload(); await rendered(wrapper, "replacement");
    expect(controller.state).toMatchObject({ stale: false, canExport: true, error: null });
  });

  it("preserves page and both scroll axes for the same query/template, resetting on changed parameters or template key", async () => {
    const { wrapper, controller } = create({ refresh: { retainPrevious: true, key: "v1" } });
    await rendered(wrapper, "initial");
    controller.gotoPage(2);
    const viewport = wrapper.find(".mrp-body").element as HTMLElement;
    viewport.scrollTop = 780; viewport.scrollLeft = 70;
    await controller.reload(); await flushPromises();
    expect(controller.state!.currentPage).toBe(2);
    expect(viewport.scrollTop).toBe(780); expect(viewport.scrollLeft).toBe(70);
    await wrapper.setProps({ params: { plant: "B" } }); await flushPromises();
    expect(controller.state!.currentPage).toBe(1); expect(viewport.scrollTop).toBe(0); expect(viewport.scrollLeft).toBe(0);
    controller.gotoPage(2); viewport.scrollLeft = 65;
    await wrapper.setProps({ refresh: { retainPrevious: true, key: "v2" } }); await flushPromises();
    expect(controller.state!.currentPage).toBe(1); expect(viewport.scrollLeft).toBe(0);
  });

  it("cancellation keeps the retained snapshot and ignores a late adapter response", async () => {
    const pending = deferred<RenderPlan>();
    const fetcher = vi.fn<PlanFetcher>().mockResolvedValueOnce(plan("original")).mockReturnValueOnce(pending.promise);
    const { wrapper, controller } = create({ fetcher, refresh: { retainPrevious: true } });
    await rendered(wrapper, "original"); const loading = controller.reload(); controller.cancelTask!();
    pending.resolve(plan("late")); await loading; await nextTick();
    expect(controller.getPlan!()!.pages[0]!.components[0]!.text).toBe("original 1");
    expect(controller.state).toMatchObject({ stale: true, loading: false, canExport: false });
  });

  it("host pending blocks existing output and editing without clearing the displayed draft", async () => {
    const { wrapper, controller } = create({ editable: true, refresh: { retainPrevious: true } });
    await rendered(wrapper, "initial");
    const snapshot = controller.getPlan!();
    await wrapper.setProps({ refresh: { retainPrevious: true, pending: true } });
    expect(controller.state).toMatchObject({ loading: true, canExport: false, canPrint: false });
    expect(controller.getPlan!()).toEqual(snapshot);
    await wrapper.setProps({ refresh: { retainPrevious: true, pending: false } });
    expect(controller.state!.canExport).toBe(true);
  });

  it("freezes an already open draft during host refresh, retaining its input until the host restores editing", async () => {
    const grid: RenderPlan = { schemaVersion: "test", pages: [{ pageWidthMm: 210, pageHeightMm: 200, components: [
      { kind: "rect", leftMm: 5, topMm: 5, widthMm: 100, heightMm: 20, grid: { colWidthsMm: [100], cells: [[{ value: 5, text: "5" }]] } }
    ] }] };
    const save = vi.fn();
    const { wrapper, controller } = create({ fetcher: async () => grid, editable: { save }, refresh: { retainPrevious: true } });
    await vi.waitFor(() => expect(wrapper.find("td").exists()).toBe(true));
    await wrapper.find("td").trigger("dblclick");
    await vi.waitFor(() => expect(wrapper.find("textarea").exists()).toBe(true));
    await wrapper.find("textarea").setValue("8");
    const input = wrapper.find("textarea").element as HTMLTextAreaElement;
    await wrapper.setProps({ refresh: { retainPrevious: true, pending: true } });
    expect(input.disabled).toBe(true); expect(input.value).toBe("8");
    await wrapper.find("textarea").trigger("blur"); await flushPromises();
    expect(save).not.toHaveBeenCalled(); expect(controller.getChanges!()).toEqual([]);
    expect(controller.state!.pendingLocalChanges).toBe(true);
    await wrapper.setProps({ refresh: { retainPrevious: true, pending: false, stale: true } });
    expect(input.disabled).toBe(true); expect(input.value).toBe("8");
    await wrapper.setProps({ refresh: { retainPrevious: true, pending: false, stale: false } });
    expect(input.disabled).toBe(false); expect(input.value).toBe("8");
    await wrapper.find("textarea").trigger("keydown", { key: "Enter" });
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(controller.getPlan!()!.pages[0]!.components[0]!.grid!.cells[0]![0]!.value).toBe(8);
  });

  it("host-declared stale snapshots block editing and output without appearing as a running request", async () => {
    const grid: RenderPlan = { schemaVersion: "test", pages: [{ pageWidthMm: 210, pageHeightMm: 200, components: [
      { kind: "rect", leftMm: 5, topMm: 5, widthMm: 100, heightMm: 20, grid: { colWidthsMm: [100], cells: [[{ value: 5, text: "5" }]] } }
    ] }] };
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { wrapper, controller } = create({ fetcher: async () => grid, editable: true, refresh: { retainPrevious: true } });
    await vi.waitFor(() => expect(wrapper.find("td").exists()).toBe(true));
    await wrapper.setProps({ refresh: { retainPrevious: true, stale: true } });
    expect(controller.state).toMatchObject({ loading: false, stale: true, hasPlan: true, canExport: false, canPrint: false });
    expect(wrapper.find(".mrp-stale-snapshot").exists()).toBe(true);
    await wrapper.find("td").trigger("dblclick"); await flushPromises();
    expect(wrapper.find("textarea").exists()).toBe(false);
    await controller.exportAs("html"); expect(click).not.toHaveBeenCalled();
    await wrapper.setProps({ refresh: { retainPrevious: true, stale: false } });
    expect(controller.state).toMatchObject({ loading: false, stale: false, canExport: true });
    expect(wrapper.find(".mrp-stale-snapshot").exists()).toBe(false);
    await wrapper.find("td").trigger("dblclick");
    await vi.waitFor(() => expect(wrapper.find("textarea").exists()).toBe(true));
  });

  it("retries a host-owned stale snapshot through its callback, deduplicating clicks until the host updates it", async () => {
    const pending = deferred<void>();
    const fetcher = vi.fn<PlanFetcher>().mockResolvedValue(plan("original"));
    const retry = vi.fn(async () => {
      await pending.promise;
      await wrapper.setProps({ refresh: { retainPrevious: true, stale: false, retry }, fetcher: async () => plan("recovered") });
    });
    const { wrapper, controller } = create({ fetcher, refresh: { retainPrevious: true, stale: true, retry } });
    await rendered(wrapper, "original");
    await wrapper.find(".mrp-stale-snapshot .mrp-retry").trigger("click");
    expect(retry).toHaveBeenCalledOnce();
    expect(wrapper.find(".mrp-stale-snapshot .mrp-retry").attributes("disabled")).toBeDefined();
    await wrapper.find(".mrp-stale-snapshot .mrp-retry").trigger("click");
    expect(retry).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
    expect(controller.state!.stale).toBe(true);
    pending.resolve(); await rendered(wrapper, "recovered");
    expect(controller.state).toMatchObject({ stale: false, canExport: true });
  });

  it("reports host retry failures without changing the host-owned stale flag, and permits another attempt", async () => {
    const retry = vi.fn().mockRejectedValueOnce(new Error("host query failed")).mockResolvedValueOnce(undefined);
    const { wrapper, controller } = create({ refresh: { retainPrevious: true, stale: true, retry } });
    await rendered(wrapper, "initial");
    await wrapper.find(".mrp-stale-snapshot .mrp-retry").trigger("click"); await flushPromises();
    expect(controller.state).toMatchObject({ stale: true, error: { code: "fetch", message: "host query failed" } });
    expect(wrapper.emitted("error")?.at(-1)?.[0]).toBe("host query failed");
    expect(wrapper.find(".mrp-stale-snapshot .mrp-retry").attributes("disabled")).toBeUndefined();
    await wrapper.find(".mrp-stale-snapshot .mrp-retry").trigger("click"); await flushPromises();
    expect(retry).toHaveBeenCalledTimes(2); expect(controller.state!.stale).toBe(true);
  });

  it("keeps internal reload as the retry path for SDK-owned failures even when a host retry exists", async () => {
    const retry = vi.fn();
    const fetcher = vi.fn<PlanFetcher>().mockResolvedValueOnce(plan("original")).mockRejectedValueOnce(new Error("sdk query failed")).mockResolvedValueOnce(plan("recovered"));
    const { wrapper, controller } = create({ fetcher, refresh: { retainPrevious: true, retry } });
    await rendered(wrapper, "original"); await controller.reload(); await nextTick();
    await wrapper.find(".mrp-stale-snapshot .mrp-retry").trigger("click");
    await rendered(wrapper, "recovered");
    expect(fetcher).toHaveBeenCalledTimes(3); expect(retry).not.toHaveBeenCalled();
  });

  it("cancels in-flight output when a retained refresh starts without changing the old plan reference", async () => {
    const pending = deferred<RenderPlan>(), encoded = deferred<Uint8Array>();
    const exporter = vi.fn(() => encoded.promise);
    const fetcher = vi.fn<PlanFetcher>().mockResolvedValueOnce(plan("original")).mockReturnValueOnce(pending.promise);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:refresh-output");
    const { wrapper, controller } = create({ fetcher, refresh: { retainPrevious: true } }, { [MACH_REPORT_PDF_EXPORTER_KEY]: exporter });
    await rendered(wrapper, "original");
    const output = controller.exportAs("pdf");
    await vi.waitFor(() => expect(exporter).toHaveBeenCalled());
    const loading = controller.reload();
    encoded.resolve(new Uint8Array([37, 80, 68, 70])); await output;
    expect(click).not.toHaveBeenCalled();
    pending.resolve(plan("replacement")); await loading;
  });

  it("manual hosts changing parameters fence an in-flight refresh without removing the last snapshot", async () => {
    const pending = deferred<RenderPlan>();
    const fetcher = vi.fn<PlanFetcher>().mockResolvedValueOnce(plan("original")).mockReturnValueOnce(pending.promise);
    const { wrapper, controller } = create({ autoLoad: false, fetcher, refresh: { retainPrevious: true } });
    await controller.reload(); await rendered(wrapper, "original");
    const loading = controller.reload();
    await wrapper.setProps({ params: { plant: "B" } }); await flushPromises();
    pending.resolve(plan("obsolete")); await loading; await nextTick();
    expect(controller.state).toMatchObject({ loading: false, stale: true });
    expect(controller.state!.params).toEqual({ plant: "A" });
    expect(wrapper.find(".mr-page").text()).toContain("original");
  });

  it("keeps local cell changes and history after a failed refresh", async () => {
    const editedPlan: RenderPlan = { schemaVersion: "test", pages: [{ pageWidthMm: 210, pageHeightMm: 200, components: [
      { kind: "rect", leftMm: 5, topMm: 5, widthMm: 100, heightMm: 20, grid: { colWidthsMm: [100], cells: [[{ value: 5, text: "5" }]] } }
    ] }] };
    const fetcher = vi.fn<PlanFetcher>().mockResolvedValueOnce(editedPlan).mockRejectedValueOnce(new Error("refresh failed"));
    const { wrapper, controller } = create({ fetcher, editable: true, beforeDiscard: () => true, refresh: { retainPrevious: true } });
    await vi.waitFor(() => expect(wrapper.find("td").exists()).toBe(true));
    await wrapper.find("td").trigger("dblclick");
    await vi.waitFor(() => expect(wrapper.find("textarea").exists()).toBe(true));
    await wrapper.find("textarea").setValue("8"); await wrapper.find("textarea").trigger("keydown", { key: "Enter" });
    await vi.waitFor(() => expect(controller.state!.changeCount).toBe(1));
    await controller.reload(); await nextTick();
    expect(controller.getPlan!()!.pages[0]!.components[0]!.grid!.cells[0]![0]!.value).toBe(8);
    expect(controller.getDifferences!()).toHaveLength(1);
    expect(controller.state!.pendingLocalChanges).toBe(true);
    expect(await controller.undo!()).toBe(false);
  });

  it("loads scoped zoom without overwriting delayed preferences, keeps tool changes in the same record and resets locally", async () => {
    const pending = deferred<ReportStoredPreferences | null>();
    const save = vi.fn();
    const { wrapper } = create({ preferences: { key: "tenant/user/report/v1", adapter: { load: () => pending.promise, save } } });
    await rendered(wrapper, "initial");
    expect(save).not.toHaveBeenCalled();
    pending.resolve({ zoomMode: 150, thumbnails: false }); await flushPromises();
    expect(wrapper.find(".mrp-scale-inner").attributes("style")).toContain("scale(1.5)");
    expect(localStorage.getItem("mach-report:ui")).toBeNull();
    const raw = wrapper.findAll(".mrp-toolbar button").find(button => button.text() === "100%")!;
    await raw.trigger("click"); await flushPromises();
    expect(save).toHaveBeenLastCalledWith("tenant/user/report/v1", { zoomMode: 100, thumbnails: false });
    await wrapper.find(".mrp-settings-toggle").trigger("click");
    await wrapper.find(".mrp-settings-panel footer button").trigger("click"); await flushPromises();
    expect(save).toHaveBeenLastCalledWith("tenant/user/report/v1", {});
  });

  it("isolates a new preference scope and displays the host's precise capability reason", async () => {
    const values: Record<string, ReportStoredPreferences> = { A: { zoomMode: 150 }, B: { zoomMode: 100 } };
    const adapter = { load: (key: string) => values[key] || null, save: vi.fn() };
    const { wrapper } = create({ preferences: { key: "A", adapter }, editable: false, toolbar: { unavailableReasons: { editing: "封月报表不可修改" } } });
    await rendered(wrapper, "initial"); await flushPromises();
    expect(wrapper.find(".mrp-scale-inner").attributes("style")).toContain("scale(1.5)");
    await wrapper.setProps({ preferences: { key: "B", adapter } }); await flushPromises();
    expect(wrapper.find(".mrp-scale-inner").attributes("style")).toContain("scale(1)");
    await wrapper.find(".mrp-settings-toggle").trigger("click");
    await wrapper.find('[role="tab"][id$="-tools"]').trigger("click");
    expect(wrapper.find(".mrp-settings-panel").text()).toContain("封月报表不可修改");
  });
});
