// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ReportPreview from "../ReportPreview.vue";
import { buildWordHtml, usePrintExport } from "../composables/usePrintExport";
import { createDefaultPdfExporter } from "../pdf-exporter";
import { ref, shallowRef } from "vue";
import type { RenderPlan } from "@agile-team/mach-report";

const plan: RenderPlan = {
  schemaVersion: "t",
  pages: [
    {
      pageWidthMm: 210,
      pageHeightMm: 297,
      components: [
        { kind: "text", leftMm: 10, topMm: 10, widthMm: 80, heightMm: 8, text: "出库单明细" }
      ]
    },
    { pageWidthMm: 297, pageHeightMm: 210, components: [] }
  ]
};

describe("buildWordHtml（Word 兼容导出）", () => {
  it("带 Word 命名空间与 Print 视图头，保留页面内容与分页规则", () => {
    const { html, filename } = buildWordHtml(plan);
    expect(filename).toBe("mach-report.doc");
    expect(html).toContain("xmlns:w=\"urn:schemas-microsoft-com:office:word\"");
    expect(html).toContain("<w:View>Print</w:View>");
    expect(html).toContain("出库单明细");
    // named pages 分页规则随行（混合纸张在 Word 中保持尺寸）
    expect(html).toContain("@page p210x297");
    expect(html).toContain("@page p297x210");
    expect(html).not.toContain("<!doctype html><html><head>"); // 头部被 Word 版替换
  });
});

describe("exportAs 出口矩阵接线", () => {
  it("await 等待导出完成，重复 PDF 调用共享生成和下载", async () => {
    let finish!: (bytes: Uint8Array) => void;
    const exporter = vi.fn(() => new Promise<Uint8Array>((resolve) => { finish = resolve; }));
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shared-pdf");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const api = usePrintExport(shallowRef(plan), { getPdfExporter: () => exporter, onError: vi.fn() });
    try {
      let settled = false;
      const first = api.exportAs("pdf").then(() => { settled = true; });
      const second = api.exportAs("pdf");
      await vi.waitFor(() => expect(exporter).toHaveBeenCalledOnce());
      expect(settled).toBe(false);
      finish(new Uint8Array([37, 80, 68, 70]));
      await Promise.all([first, second]);
      expect(createUrl).toHaveBeenCalledOnce();
      expect(settled).toBe(true);
    } finally {
      api.dispose();
      createUrl.mockRestore();
      revokeUrl.mockRestore();
    }
  });

  it("XLSX 同一计划去重，Excel 完成后仍等待并发 PDF", async () => {
    const xlsx = await import("@agile-team/mach-report/xlsx");
    let finishExcel!: (value: Awaited<ReturnType<typeof xlsx.renderPlanToXlsx>>) => void;
    const renderExcel = vi.spyOn(xlsx, "renderPlanToXlsx").mockImplementation(() => new Promise((resolve) => { finishExcel = resolve; }));
    let finishPdf!: (bytes: Uint8Array) => void;
    const exporter = vi.fn(() => new Promise<Uint8Array>((resolve) => { finishPdf = resolve; }));
    const onBusy = vi.fn();
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:concurrent");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const api = usePrintExport(shallowRef(plan), { getPdfExporter: () => exporter, onBusy, onError: vi.fn() });
    try {
      const pdf = api.exportAs("pdf");
      const firstExcel = api.exportAs("xlsx");
      const secondExcel = api.exportAs("excel");
      expect(onBusy.mock.calls.map(([format]) => format)).toEqual(["PDF", "Excel"]);
      await vi.waitFor(() => expect(renderExcel).toHaveBeenCalledOnce());
      finishExcel({
        workbook: {} as Awaited<ReturnType<typeof xlsx.renderPlanToXlsx>>["workbook"],
        buffer: new ArrayBuffer(2),
        warnings: []
      });
      await Promise.all([firstExcel, secondExcel]);
      expect(createUrl).toHaveBeenCalledOnce();
      expect(onBusy.mock.calls.map(([format]) => format)).toEqual(["PDF", "Excel", "PDF"]);
      finishPdf(new Uint8Array([37, 80, 68, 70]));
      await pdf;
      expect(onBusy.mock.calls.map(([format]) => format)).toEqual(["PDF", "Excel", "PDF", null]);
      expect(createUrl).toHaveBeenCalledTimes(2);
    } finally {
      api.dispose();
      renderExcel.mockRestore();
      createUrl.mockRestore();
      revokeUrl.mockRestore();
    }
  });

  it.each(["switch", "dispose"] as const)("%s 后旧 PDF 的成功、错误和告警均失效", async (action) => {
    const current = shallowRef<RenderPlan | null>(plan);
    let finish!: (bytes: Uint8Array) => void;
    let fail!: (reason: Error) => void;
    let warn!: (message: string) => void;
    let runs = 0;
    const onError = vi.fn();
    const onWarning = vi.fn();
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:stale");
    const api = usePrintExport(current, {
      getPdfExporter: () => (_plan, onWarn) => {
        runs++;
        warn = onWarn!;
        return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
      },
      onError,
      onWarning
    });
    try {
      const pending = api.exportAs("pdf");
      await vi.waitFor(() => expect(finish).toBeDefined());
      if (action === "switch") current.value = { ...plan, pages: [] };
      else api.dispose();
      warn("旧字体告警");
      fail(new Error("旧任务失败"));
      await pending;
      expect(onError).not.toHaveBeenCalled();
      expect(onWarning).not.toHaveBeenCalled();
      expect(createUrl).not.toHaveBeenCalled();

      // disposed 句柄不会发起第二次工作；切换后新计划也不能复用旧 promise。
      if (action === "switch") current.value = plan;
      const next = api.exportAs("pdf");
      if (action === "switch") {
        await vi.waitFor(() => expect(runs).toBe(2));
        current.value = null;
        finish(new Uint8Array([37, 80, 68, 70]));
      }
      await next;
      expect(createUrl).not.toHaveBeenCalled();
      if (action === "dispose") expect(runs).toBe(1);
    } finally {
      api.dispose();
      createUrl.mockRestore();
    }
  });

  it("PDF 窗口在用户操作中同步打开；卸载关闭尚未生成的空窗口", async () => {
    let finish!: (bytes: Uint8Array) => void;
    const exporter = vi.fn(() => new Promise<Uint8Array>((resolve) => { finish = resolve; }));
    const viewer = { closed: false, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(viewer as unknown as Window);
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pending-window");
    const onError = vi.fn();
    const api = usePrintExport(shallowRef(plan), { getPdfExporter: () => exporter, onError });
    try {
      api.openPdfWindow();
      expect(open).toHaveBeenCalledWith("", "_blank");
      expect(exporter).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(exporter).toHaveBeenCalledOnce());
      api.dispose();
      expect(viewer.close).toHaveBeenCalledOnce();
      finish(new Uint8Array([37, 80, 68, 70]));
      await Promise.resolve();
      await Promise.resolve();
      expect(createUrl).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    } finally {
      api.dispose();
      open.mockRestore();
      createUrl.mockRestore();
    }
  });

  it.each(["switch", "dispose"] as const)("%s 后 XLSX 生成结果不再下载或报告内容遗漏", async (action) => {
    const xlsx = await import("@agile-team/mach-report/xlsx");
    let finish!: (value: Awaited<ReturnType<typeof xlsx.renderPlanToXlsx>>) => void;
    const renderExcel = vi.spyOn(xlsx, "renderPlanToXlsx").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const current = shallowRef<RenderPlan | null>(plan);
    const onError = vi.fn();
    const onWarning = vi.fn();
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:stale-excel");
    const api = usePrintExport(current, { getPdfExporter: () => vi.fn(), onError, onWarning });
    try {
      const pending = api.exportAs("xlsx");
      await vi.waitFor(() => expect(renderExcel).toHaveBeenCalledOnce());
      if (action === "switch") current.value = null;
      else api.dispose();
      finish({
        workbook: {} as Awaited<ReturnType<typeof xlsx.renderPlanToXlsx>>["workbook"],
        buffer: new ArrayBuffer(2),
        warnings: ["旧报表图形未导出"]
      });
      await pending;
      expect(onError).not.toHaveBeenCalled();
      expect(onWarning).not.toHaveBeenCalled();
      expect(createUrl).not.toHaveBeenCalled();
    } finally {
      api.dispose();
      renderExcel.mockRestore();
      createUrl.mockRestore();
    }
  });

  it("打印准备期间卸载不会再弹出打印窗口", async () => {
    vi.useFakeTimers();
    const api = usePrintExport(shallowRef(plan), { getPdfExporter: () => vi.fn(), onError: vi.fn() });
    try {
      const pending = api.print();
      const frame = document.querySelector("iframe")!;
      const print = vi.fn();
      Object.defineProperty(frame.contentWindow!, "print", { value: print, configurable: true });
      api.dispose();
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(print).not.toHaveBeenCalled();
      expect(frame.isConnected).toBe(false);
    } finally {
      api.dispose();
      vi.useRealTimers();
    }
  });

  it("PDF 异步生成期间报告忙碌状态，失败后清除", async () => {
    const onBusy = vi.fn();
    const onError = vi.fn();
    const api = usePrintExport(ref(plan), {
      getPdfExporter: () => async () => { throw new Error("字体不可用"); },
      onBusy,
      onError
    });
    api.exportAs("pdf");
    expect(onBusy).toHaveBeenCalledWith("PDF");
    await vi.waitFor(() => expect(onBusy).toHaveBeenCalledWith(null));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("字体不可用"), "pdf");
  });

  it("未知格式拒绝；PDF 窗口装载 application/pdf，Excel 下载真实 xlsx", async () => {
    const onError = vi.fn();
    const onWarning = vi.fn();
    const blobs: Blob[] = [];
    const createUrl = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return `blob:test-${blobs.length}`;
    });
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const iframe = { title: "", style: { cssText: "" }, src: "" };
    const viewer = {
      document: {
        title: "",
        documentElement: { style: { height: "" } },
        body: { style: { cssText: "" }, replaceChildren: vi.fn() },
        createElement: vi.fn().mockReturnValue(iframe)
      },
      close: vi.fn()
    };
    const open = vi.spyOn(window, "open").mockReturnValue(viewer as unknown as Window);
    try {
      const api = usePrintExport(ref(plan), {
        getPdfExporter: () => async () => new Uint8Array([37, 80, 68, 70]),
        onError,
        onWarning
      });
      api.exportAs("bogus");
      expect(onError).toHaveBeenCalledWith("不支持的导出格式：bogus", "export");
      api.openPdfWindow();
      await vi.waitFor(() => expect(iframe.src).toBe("blob:test-1"));
      expect(viewer.document.body.replaceChildren).toHaveBeenCalledWith(iframe);
      expect(blobs[0]?.type).toBe("application/pdf");
      api.exportAs("xlsx");
      await vi.waitFor(() => expect(blobs.some((b) => b.type.includes("spreadsheetml.sheet"))).toBe(true), { timeout: 10000 });
      expect(open).toHaveBeenCalledWith("", "_blank");
    } finally {
      createUrl.mockRestore();
      revokeUrl.mockRestore();
      open.mockRestore();
    }
  }, 15000);

  it("默认 PDF 导出器遇到中文缺字时失败，不下载残缺文件", async () => {
    const exporter = createDefaultPdfExporter({ fontUrl: "" });
    await expect(exporter(plan)).rejects.toThrow(/字体/);
  });

  it("png/word 别名正确分发（happy-dom 无 2D：图片导出走 export 错误码不崩溃）", async () => {
    const onError = vi.fn();
    const fetcher = async () => ({
      schemaVersion: "t",
      pages: [{ pageWidthMm: 210, pageHeightMm: 100, components: [] as never[] }]
    });
    const wrapper = mount(ReportPreview, {
      props: { reportId: "T1", autoLoad: true, fetcher, onError },
      attachTo: document.body
    });
    await vi.waitFor(() => {
      expect(wrapper.element.querySelector(".mrp-page-holder")).toBeTruthy();
    }, { timeout: 5000 });
    // 工具栏出现三个按需导出按钮
    const texts = wrapper.findAll("button").map((b) => b.text());
    expect(texts.some((t) => t.includes("导出 Excel"))).toBe(true);
    expect(texts.some((t) => t.includes("导出图片"))).toBe(true);
    expect(texts.some((t) => t.includes("导出 Word"))).toBe(true);
    // Word 导出：触发下载路径（happy-dom 下 a.click 为 no-op，不应崩溃/报错）
    const wordBtn = wrapper.findAll("button").find((b) => b.text().includes("导出 Word"))!;
    await wordBtn.trigger("click");
    expect(onError).not.toHaveBeenCalled();
    wrapper.unmount();
  }, 15000);
});
