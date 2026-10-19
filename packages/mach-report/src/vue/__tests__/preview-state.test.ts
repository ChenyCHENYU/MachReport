// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, provide, reactive } from "vue";
import type { RenderPlan } from "@agile-team/mach-report";
import ReportPreview from "../ReportPreview.vue";
import type { PlanFetcher } from "../adapters";
import { provideMachReportConfig, type MachReportDefaults } from "../config";
import { useMachReport, type MachReportController } from "../controller";
import { MACH_REPORT_PDF_EXPORTER_KEY } from "../injection-keys";
import { createDefaultPdfExporter, type PdfExporter, type PdfFontCheckResult } from "../pdf-exporter";

const mounted = new Set<VueWrapper>();
const pdfBytes = new Uint8Array([37, 80, 68, 70, 45]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  // happy-dom 不支持 iframe 的 blob 导航；保持窗口渲染断言且隔离真实网络。
  vi.spyOn(URL, "createObjectURL").mockReturnValue("about:blank");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  for (const wrapper of mounted) wrapper.unmount();
  mounted.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function unmount(wrapper: VueWrapper): void {
  wrapper.unmount();
  mounted.delete(wrapper);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function planOf(pageCount = 3): RenderPlan {
  return {
    schemaVersion: "state-test",
    pages: Array.from({ length: pageCount }, (_, i) => ({
      pageWidthMm: 210,
      pageHeightMm: 100,
      components: [{ kind: "text", leftMm: 10, topMm: 10, widthMm: 80, heightMm: 8, text: `Page ${i + 1}` }]
    }))
  };
}

function defaultExporter(): PdfExporter {
  return Object.assign(vi.fn(async () => pdfBytes), {
    checkFont: vi.fn(async (): Promise<PdfFontCheckResult> => ({ status: "available", fontUrl: "/state-test.ttf" }))
  });
}

function fontFlights() {
  const pending: Array<ReturnType<typeof deferred<PdfFontCheckResult>> & { signal?: AbortSignal }> = [];
  const exporter: PdfExporter = Object.assign(vi.fn(async () => pdfBytes), {
    // 故意忽略 signal，验证旧自定义导出器也不能覆盖当前诊断。
    checkFont: vi.fn((signal?: AbortSignal) => {
      const flight = { ...deferred<PdfFontCheckResult>(), signal };
      pending.push(flight);
      return flight.promise;
    })
  });
  return { exporter, pending };
}

function session(options: {
  fetcher?: PlanFetcher;
  exporter?: PdfExporter;
  defaults?: MachReportDefaults;
  autoLoad?: boolean;
  onLoaded?: (pageCount: number) => void;
  onError?: (message: string) => void;
} = {}) {
  const report = useMachReport();
  const { state } = report;
  const defaults = reactive<MachReportDefaults>(options.defaults ?? { pdfFontUrl: "/state-test.ttf" });
  const exporter = options.exporter ?? defaultExporter();
  const fetcher: PlanFetcher = options.fetcher ?? (async () => planOf());
  const Parent = defineComponent({
    setup() {
      provideMachReportConfig(defaults);
      provide(MACH_REPORT_PDF_EXPORTER_KEY, exporter);
      return () => h("main", [
        h("output", { "data-testid": "state" }, `${state.loading}:${state.pageCount}:${state.currentPage}:${state.exporting}:${state.printing}:${state.pdfFont.status}`),
        h(ReportPreview, {
          ref: report.ref,
          reportId: "sample",
          fetcher,
          autoLoad: options.autoLoad ?? true,
          onLoaded: options.onLoaded,
          onError: options.onError
        })
      ]);
    }
  });
  function mountParent(): VueWrapper {
    const wrapper = mount(Parent, { attachTo: document.body });
    mounted.add(wrapper);
    return wrapper;
  }
  return { report, state, defaults, exporter, mountParent };
}

async function settle(): Promise<void> {
  await nextTick();
  await flushPromises();
  await nextTick();
}

describe("真实预览组件的父页面状态句柄", () => {
  it("解构 state 在挂载、加载、翻页和卸载时持续响应，ready 仅代表挂载", async () => {
    const load = deferred<RenderPlan>();
    const { report, state, mountParent } = session({ fetcher: () => load.promise });
    expect(report.ready.value).toBe(false);
    expect(state).toMatchObject({ loading: false, hasPlan: false, pageCount: 0, currentPage: 1, canExport: false, canPrint: false });
    const wrapper = mountParent();
    await nextTick();
    expect(report.ready.value).toBe(true);
    expect(state.loading).toBe(true);
    expect(state.hasPlan).toBe(false);
    expect(wrapper.get("output").text()).toContain("true:0:1");
    load.resolve(planOf());
    await settle();
    expect(report.state).toBe(state);
    expect(state).toMatchObject({ loading: false, hasPlan: true, pageCount: 3, currentPage: 1, canExport: true, canPrint: true });
    const exposed = wrapper.getComponent(ReportPreview).vm as unknown as MachReportController;
    expect(Object.isFrozen(exposed.state)).toBe(true);
    expect(Reflect.set(exposed.state!, "currentPage", 999)).toBe(false);
    report.gotoPage(2);
    await nextTick();
    expect(state.currentPage).toBe(2);
    expect(wrapper.get("output").text()).toContain("false:3:2");
    report.gotoPage(99);
    expect(state.currentPage).toBe(3);
    report.gotoPage(-1);
    expect(state.currentPage).toBe(1);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Reflect.set(state, "pageCount", 999)).toBe(false);
    expect(Object.isFrozen(state.pdfFont)).toBe(true);
    expect(Reflect.set(state.pdfFont, "status", "error")).toBe(false);
    unmount(wrapper);
    expect(report.ready.value).toBe(false);
    expect(state).toMatchObject({ loading: false, hasPlan: false, pageCount: 0, currentPage: 1, exporting: null, printing: false });
  });

  it("加载失败保留结构化只读错误，下次成功重置错误和页码", async () => {
    const cause = new Error("business fetch failed");
    const fetcher = vi.fn<PlanFetcher>()
      .mockResolvedValueOnce(planOf())
      .mockRejectedValueOnce(cause)
      .mockResolvedValueOnce(planOf(1));
    const onError = vi.fn();
    const { report, state, mountParent } = session({ fetcher, onError });
    mountParent();
    await settle();
    report.gotoPage(3);
    await report.reload();
    expect(report.ready.value).toBe(true);
    expect(state).toMatchObject({ loading: false, hasPlan: false, pageCount: 0, currentPage: 1, canExport: false, canPrint: false });
    expect(state.error).toMatchObject({ code: "fetch", message: cause.message, cause });
    expect(Object.isFrozen(state.error)).toBe(true);
    expect(onError).toHaveBeenCalledOnce();
    await report.reload();
    await settle();
    expect(state).toMatchObject({ hasPlan: true, pageCount: 1, currentPage: 1, error: null, canExport: true, canPrint: true });
  });

  it("并发 PDF 下载共享生成，busy 与实际 Promise 的结束保持一致", async () => {
    const pdf = deferred<Uint8Array>();
    const exporter = Object.assign(vi.fn(() => pdf.promise), { checkFont: defaultExporter().checkFont });
    const { report, state, mountParent } = session({ exporter });
    const wrapper = mountParent();
    await settle();
    let completed = false;
    const first = report.exportAs("pdf").then(() => { completed = true; });
    const second = report.exportAs("pdf");
    expect(state).toMatchObject({ exporting: "PDF", canExport: false, canPrint: true });
    await settle();
    expect(exporter).toHaveBeenCalledOnce();
    expect(completed).toBe(false);
    expect(wrapper.get("output").text()).toContain(":PDF:false:");
    pdf.resolve(pdfBytes);
    await Promise.all([first, second]);
    expect(completed).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(state).toMatchObject({ exporting: null, canExport: true, error: null });
  });

  it("PDF 导出错误不丢计划，后续成功恢复错误和导出能力", async () => {
    const exporter = Object.assign(vi.fn<(plan: RenderPlan) => Promise<Uint8Array>>()
      .mockRejectedValueOnce(new Error("font cannot encode text"))
      .mockResolvedValueOnce(pdfBytes), { checkFont: defaultExporter().checkFont });
    const { report, state, mountParent } = session({ exporter });
    mountParent();
    await settle();
    await report.exportAs("pdf");
    expect(state.error).toMatchObject({ code: "pdf", message: "PDF 导出失败: font cannot encode text" });
    expect(state).toMatchObject({ hasPlan: true, exporting: null, canExport: true });
    await report.exportAs("pdf");
    expect(state.error).toBeNull();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });

  it("打印期间 printing 状态阻止重复打印，结束后恢复 canPrint", async () => {
    const { report, state, mountParent } = session();
    mountParent();
    await settle();
    const printing = report.print();
    expect(state).toMatchObject({ printing: true, canPrint: false, canExport: true });
    const frame = document.querySelector("iframe")!;
    const focus = vi.spyOn(frame.contentWindow!, "focus").mockImplementation(() => {});
    const print = vi.fn();
    Object.defineProperty(frame.contentWindow!, "print", { configurable: true, value: print });
    await report.print();
    expect(state.printing).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    await printing;
    expect(focus).toHaveBeenCalledOnce();
    expect(print).toHaveBeenCalledOnce();
    expect(state).toMatchObject({ printing: false, canPrint: true, error: null });
  });

  it("PDF 窗口同步打开，与并发下载共享生成并持续报告 busy", async () => {
    const pdf = deferred<Uint8Array>();
    const exporter = Object.assign(vi.fn(() => pdf.promise), { checkFont: defaultExporter().checkFont });
    const viewer = { closed: false, close: vi.fn(), document: document.implementation.createHTMLDocument() };
    const open = vi.spyOn(window, "open").mockReturnValue(viewer as unknown as Window);
    const { report, state, mountParent } = session({ exporter });
    mountParent();
    await settle();
    report.openPdfWindow();
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(exporter).not.toHaveBeenCalled();
    expect(state).toMatchObject({ exporting: "PDF", canExport: false });
    const download = report.exportAs("pdf");
    await settle();
    expect(exporter).toHaveBeenCalledOnce();
    pdf.resolve(pdfBytes);
    await download;
    await settle();
    expect(viewer.document.querySelector("iframe")?.getAttribute("src")).toBe("about:blank");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(state).toMatchObject({ exporting: null, canExport: true, error: null });
  });

  it("卸载取消待生成 PDF 窗口，旧导出完成不能污染空状态或生成下载", async () => {
    const pdf = deferred<Uint8Array>();
    const exporter = Object.assign(vi.fn(() => pdf.promise), { checkFont: defaultExporter().checkFont });
    const viewer = { closed: false, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(viewer as unknown as Window);
    const { report, state, mountParent } = session({ exporter });
    const wrapper = mountParent();
    await settle();
    report.openPdfWindow();
    const download = report.exportAs("pdf");
    await settle();
    unmount(wrapper);
    expect(viewer.close).toHaveBeenCalledOnce();
    expect(report.ready.value).toBe(false);
    expect(state).toMatchObject({ exporting: null, hasPlan: false, pageCount: 0, error: null });
    pdf.resolve(pdfBytes);
    await download;
    await settle();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(state).toMatchObject({ exporting: null, error: null });
  });

  it("旧自定义 controller 无 state/checkPdfFont 仍 ready，并返回能力未验证", async () => {
    const report = useMachReport();
    const { state } = report;
    await expect(report.checkPdfFont()).rejects.toMatchObject({ code: "config" });
    const old: MachReportController = {
      reload: vi.fn(async () => {}), print: vi.fn(async () => {}), exportAs: vi.fn(),
      openPdfWindow: vi.fn(), gotoPage: vi.fn(), setParams: vi.fn()
    };
    report.ref(old);
    expect(report.ready.value).toBe(true);
    expect(state).toMatchObject({ loading: false, hasPlan: false, canExport: false, canPrint: false, pdfFont: { status: "unchecked" } });
    await expect(report.checkPdfFont()).resolves.toMatchObject({ status: "unverified" });
    await report.reload();
    expect(old.reload).toHaveBeenCalledOnce();
    report.ref(null);
    expect(report.ready.value).toBe(false);
    expect(report.state).toBe(state);
  });

  it("自动字体检查独立于 loaded，检查失败仅写入 PDF 诊断", async () => {
    const { exporter, pending } = fontFlights();
    const onLoaded = vi.fn();
    const onError = vi.fn();
    const { state, mountParent } = session({ exporter, onLoaded, onError });
    mountParent();
    await settle();
    expect(onLoaded).toHaveBeenCalledWith(3);
    expect(pending).toHaveLength(1);
    expect(state).toMatchObject({ loading: false, hasPlan: true, canExport: true, pdfFont: { status: "checking" }, error: null });
    pending[0]!.reject(new Error("HEAD blocked"));
    await settle();
    expect(state.pdfFont).toMatchObject({ status: "error", message: "HEAD blocked" });
    expect(state.error).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    expect(onLoaded).toHaveBeenCalledOnce();
  });

  it("默认导出器 HEAD 404 保留预览成功并提供字体诊断", async () => {
    const fontUrl = "/preview-state-head-404.ttf";
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const onLoaded = vi.fn();
    const onError = vi.fn();
    const { state, mountParent } = session({
      defaults: { pdfFontUrl: fontUrl }, exporter: createDefaultPdfExporter({ fontUrl }), onLoaded, onError
    });
    mountParent();
    await settle();
    expect(fetch).toHaveBeenCalledWith(fontUrl, { method: "HEAD", signal: expect.any(AbortSignal) });
    expect(onLoaded).toHaveBeenCalledWith(3);
    expect(state.pdfFont).toMatchObject({ status: "error", fontUrl });
    expect(state.pdfFont.message).toContain("HTTP 404");
    expect(state).toMatchObject({ loading: false, hasPlan: true, error: null, canExport: true });
    expect(onError).not.toHaveBeenCalled();
  });

  it("只有实际启用的 PDF 工具检查字体，纯 Excel 集成及隐藏 PDF 不显示无关字体错误", async () => {
    const { exporter, pending } = fontFlights();
    const { state, defaults, mountParent } = session({ exporter, defaults: { pdfFontUrl: "/state-test.ttf", showPdfWindow: false, toolbar: { exportFormats: ["xlsx"] } } });
    const wrapper = mountParent(); await settle();
    expect(pending).toHaveLength(0); expect(state.hasPlan).toBe(true);
    expect(wrapper.find(".mrp-export-warning").exists()).toBe(false);
    defaults.toolbar = { exportFormats: ["xlsx", "pdf"] }; await settle();
    expect(pending).toHaveLength(1);
    pending[0]!.resolve({ status: "error", fontUrl: "/state-test.ttf", message: "font not configured" }); await settle();
    expect(wrapper.find(".mrp-export-warning").exists()).toBe(true);
    await wrapper.find(".mrp-settings-toggle").trigger("click"); await settle();
    await wrapper.find('[role="tab"][id$="-tools"]').trigger("click"); await settle();
    const pdf = wrapper.findAll(".mrp-settings-option").find((label) => label.text() === "导出 PDF")!.find("input");
    await pdf.setValue(false); await settle();
    expect(wrapper.find(".mrp-export-warning").exists()).toBe(false); expect(pending).toHaveLength(1);
    await pdf.setValue(true); await settle();
    expect(pending).toHaveLength(2);
  });

  it("手动重试取消旧检查，忽略过期结果，并可从诊断失败恢复", async () => {
    const { exporter, pending } = fontFlights();
    const { report, state, mountParent } = session({ exporter });
    mountParent();
    await settle();
    const retry = report.checkPdfFont();
    expect(pending).toHaveLength(2);
    expect(pending[0]!.signal?.aborted).toBe(true);
    pending[0]!.resolve({ status: "available", fontUrl: "/stale.ttf" });
    await settle();
    expect(state.pdfFont.status).toBe("checking");
    pending[1]!.resolve({ status: "error", fontUrl: "/state-test.ttf", message: "temporary failure" });
    await retry;
    expect(state.pdfFont.status).toBe("error");
    const successfulRetry = report.checkPdfFont();
    pending[2]!.resolve({ status: "available", fontUrl: "/state-test.ttf" });
    await successfulRetry;
    expect(state.pdfFont).toMatchObject({ status: "available", fontUrl: "/state-test.ttf" });
    expect(state.error).toBeNull();
  });

  it("响应式 fontUrl 切换与卸载取消检查，过期诊断不再通知父组件", async () => {
    const { exporter, pending } = fontFlights();
    const onError = vi.fn();
    const { report, state, defaults, mountParent } = session({ exporter, onError });
    const wrapper = mountParent();
    await settle();
    defaults.pdfFontUrl = "/replacement.ttf";
    await settle();
    expect(pending).toHaveLength(2);
    expect(pending[0]!.signal?.aborted).toBe(true);
    expect(pending[1]!.signal?.aborted).toBe(false);
    expect(state.pdfFont).toMatchObject({ status: "checking", fontUrl: "/replacement.ttf" });
    pending[0]!.resolve({ status: "error", fontUrl: "/state-test.ttf", message: "old font failed" });
    await settle();
    expect(state.pdfFont.fontUrl).toBe("/replacement.ttf");
    unmount(wrapper);
    expect(pending[1]!.signal?.aborted).toBe(true);
    pending[1]!.reject(new Error("late font failure"));
    await settle();
    expect(report.ready.value).toBe(false);
    expect(state.pdfFont).toMatchObject({ status: "unchecked", fontUrl: "" });
    expect(state.error).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });
});
