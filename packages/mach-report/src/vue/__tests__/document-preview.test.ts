import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import ReportDocumentPreview from "../ReportDocumentPreview.vue";
import { windowAt } from "./document-fixture";
import type { ReportDocumentSource, ReportDocumentWindowRequest } from "../../server/document-source";
import type { ReportRuntimeExportResult } from "../../server/types";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { provideMachReportConfig } from "../config";

const wrappers: VueWrapper[] = []; afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.unstubAllGlobals(); });
function preview(source: ReportDocumentSource) { const wrapper = mount(ReportDocumentPreview, { props: { source, height: "550px" }, attachTo: document.body }); wrappers.push(wrapper); return wrapper; }
interface Handle { gotoPage(page: number): Promise<void>; reload(): Promise<void>; cancel(): void; export(format: "pdf" | "xlsx"): Promise<ReportRuntimeExportResult> }
describe("remote page-window preview", () => {
  it("does not offer a complete file for a document without committed pages", async () => {
    const wrapper = preview({ load: async () => windowAt(0, 0), export: vi.fn() });
    await vi.waitFor(() => expect(wrapper.text()).toContain("共 0 页"));
    expect(wrapper.find(".mrp-export-trigger").exists()).toBe(false);
    await expect((wrapper.vm as unknown as Handle).export("pdf")).rejects.toMatchObject({ code: "export" });
  });
  it("uses global footer/keyboard navigation while retaining only the active page in DOM", async () => {
    const load = vi.fn(async ({ fromPage }: { fromPage: number }) => windowAt(fromPage)); const wrapper = preview({ load });
    await vi.waitFor(() => expect(wrapper.find(".mr-page").text()).toContain("Page 1"));
    expect(wrapper.find(".mrp-pageinfo").text()).toBe("1 / 10000"); expect(wrapper.findAll(".mr-page")).toHaveLength(1);
    expect(wrapper.find(".mrp-search-toggle").exists()).toBe(false); expect(wrapper.find(".mrp-export-trigger").exists()).toBe(false);
    await wrapper.find(".mrp-body").trigger("keydown", { key: "End" });
    await vi.waitFor(() => expect(wrapper.find(".mr-page").text()).toContain("Page 10000")); expect(wrapper.find(".mrp-pageinfo").text()).toBe("10000 / 10000");
    expect(load).toHaveBeenCalledTimes(2); await expect((wrapper.vm as unknown as Handle).gotoPage(0)).rejects.toMatchObject({ code: "param" });
  });
  it("preserves the displayed page after failure, refreshes versions explicitly, and never enables partial export", async () => {
    let fail = false, version = "v1";
    const wrapper = preview({ load: async input => { if (fail) throw new Error("Unavailable"); return windowAt(input.fromPage, 100, version); } });
    await vi.waitFor(() => expect(wrapper.text()).toContain("Page 1")); const handle = wrapper.vm as unknown as Handle;
    fail = true; await handle.gotoPage(10); expect(wrapper.find(".mr-page").text()).toContain("Page 1"); expect(wrapper.find('[role="alert"]').text()).toBe("Unavailable");
    fail = false; version = "v2"; await handle.reload(); await vi.waitFor(() => expect(wrapper.text()).toContain("Page 1"));
    expect(wrapper.emitted("loaded")?.at(-1)?.[0]).toMatchObject({ version: "v2" });
    await expect(handle.export("pdf")).rejects.toMatchObject({ code: "export" });
  });
  it("validates complete backend export metadata and rejects a single-page substitute", async () => {
    let pages = 1;
    const exporter = vi.fn(async (): Promise<ReportRuntimeExportResult> => ({ bytes: new Uint8Array([37, 80, 68, 70]), format: "pdf", contentType: "application/pdf", stats: { rows: 2, cells: 2, pages, durationMs: 0 }, diagnostics: [], revisions: {} }));
    const wrapper = preview({ load: async input => windowAt(input.fromPage, 50), export: exporter });
    await vi.waitFor(() => expect(wrapper.text()).toContain("Page 1")); const handle = wrapper.vm as unknown as Handle;
    await expect(handle.export("pdf")).rejects.toThrow(/页数/); expect(wrapper.emitted("exported")).toBeUndefined();
    pages = 50; expect((await handle.export("pdf")).stats.pages).toBe(50); expect(exporter.mock.calls).toHaveLength(2);
    expect(wrapper.emitted("exported")).toHaveLength(1); expect(wrapper.findAll(".mr-page")).toHaveLength(1);
  });
  it("shows building/failed committed boundaries without offering full export", async () => {
    let failed = false;
    const wrapper = preview({ load: async input => { const result = windowAt(input.fromPage, 2); result.manifest.state = failed ? "failed" : "building"; result.manifest.revision = failed ? 3 : 2; if (failed) result.manifest.failure = { code: "generation", message: "Stopped" }; return result; }, export: vi.fn() });
    await vi.waitFor(() => expect(wrapper.text()).toContain("生成中")); expect(wrapper.find(".mrp-export-trigger").exists()).toBe(false);
    failed = true; await (wrapper.vm as unknown as Handle).reload(); expect(wrapper.text()).toContain("生成已停止"); await vi.waitFor(() => expect(wrapper.text()).toContain("Page 1"));
  });
  it("does not fetch document pages while rendering on the server", async () => {
    const load = vi.fn(async input => windowAt(input.fromPage));
    await renderToString(createSSRApp(ReportDocumentPreview, { source: { load } }));
    expect(load).not.toHaveBeenCalled();
  });
  it("keeps remote full-document exports independent of local PDF font loading", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("No frontend fonts")); vi.stubGlobal("fetch", fetch);
    const Parent = defineComponent({ setup() { provideMachReportConfig({ pdfFontUrl: "/remote-only.ttf" }); return () => h(ReportDocumentPreview, { source: { load: async (input: ReportDocumentWindowRequest) => windowAt(input.fromPage, 2), export: vi.fn() } }); } });
    const wrapper = mount(Parent, { attachTo: document.body }); wrappers.push(wrapper);
    await vi.waitFor(() => expect(wrapper.text()).toContain("Page 1"));
    expect(wrapper.find(".mrp-export-trigger").exists()).toBe(true);
    expect(fetch).not.toHaveBeenCalled(); expect(wrapper.find(".mrp-export-warning").exists()).toBe(false);
  });
  it("does not let a late navigation replace the newest child preview", async () => {
    const pending = new Map<number, (value: ReturnType<typeof windowAt>) => void>();
    const wrapper = preview({ load: input => input.fromPage === 0 ? Promise.resolve(windowAt(0, 50)) : new Promise(resolve => { pending.set(input.fromPage, resolve); }) });
    await vi.waitFor(() => expect(wrapper.find(".mr-page").text()).toContain("Page 1"));
    const handle = wrapper.vm as unknown as Handle, old = handle.gotoPage(10), current = handle.gotoPage(20);
    await vi.waitFor(() => expect(pending.size).toBe(2));
    pending.get(19)!(windowAt(19, 50)); await current;
    await vi.waitFor(() => expect(wrapper.find(".mr-page").text()).toContain("Page 20"));
    pending.get(9)!(windowAt(9, 50)); await old;
    expect(wrapper.find(".mr-page").text()).toContain("Page 20"); expect(wrapper.find(".mrp-pageinfo").text()).toBe("20 / 50");
    expect(wrapper.emitted("error")).toBeUndefined();
  });
  it("cancels in-flight full export and stale child loads when the source changes", async () => {
    let finish!: (value: ReportRuntimeExportResult) => void;
    const source: ReportDocumentSource = { load: async input => windowAt(input.fromPage, 5), export: () => new Promise(resolve => { finish = resolve; }) };
    const wrapper = preview(source); await vi.waitFor(() => expect(wrapper.find(".mr-page").text()).toContain("Page 1"));
    const result = (wrapper.vm as unknown as Handle).export("pdf").catch(cause => cause);
    await wrapper.setProps({ source: { load: async (input: ReportDocumentWindowRequest) => { const value = windowAt(input.fromPage, 2, "v2"); value.pages[0]!.components[0]!.text = "Replacement"; return value; } } });
    expect(await result).toMatchObject({ name: "AbortError" });
    finish({ bytes: new Uint8Array([37, 80, 68, 70]), format: "pdf", contentType: "application/pdf", stats: { rows: 0, cells: 0, pages: 5, durationMs: 0 }, diagnostics: [], revisions: {} });
    await vi.waitFor(() => expect(wrapper.find(".mr-page").text()).toBe("Replacement"));
    expect(wrapper.emitted("exported")).toBeUndefined(); expect(wrapper.emitted("error")).toBeUndefined();
  });
  it("treats a regular Error named AbortError as cancellation in the export menu", async () => {
    const wrapper = preview({ load: async input => windowAt(input.fromPage, 2), export: async () => { throw Object.assign(new Error("Adapter cancelled"), { name: "AbortError" }); } });
    await vi.waitFor(() => expect(wrapper.find(".mr-page").text()).toContain("Page 1"));
    await wrapper.find(".mrp-export-trigger").trigger("click");
    await wrapper.findAll('[role="menuitem"]').find(button => button.text().includes("PDF"))!.trigger("click");
    await vi.waitFor(() => expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false));
    expect(wrapper.emitted("error")).toBeUndefined(); expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
