import { watch, type Ref } from "vue";
import type { OutputDiagnostic, PlanPage, RenderPlan } from "@agile-team/mach-report";
import {
  renderPage as renderPageToDom,
  renderPlanToImages
} from "@agile-team/mach-report";
import { waitForOutput } from "../../output/progress";
import { assertOutputActive, notifyOutputProgress } from "../../output/progress";
import { createOutputRun, type OutputRun } from "./output-task";
import type { ReportPreviewTask } from "../guards";
import type { PdfExporter } from "../pdf-exporter";
import type { XlsxRenderOptions } from "../../xlsx/render-xlsx";
import { preparePrintResources, printResourceMessage } from "../print-resources";
import { printCalibration, snapshotPrintOptions, type ReportPrintOptions, type ReportPrintMessages } from "../print-options";

/**
 * 打印 / 导出 / PDF 窗口。
 *
 * - 打印 HTML 由 DOM 序列化（outerHTML），流式分块写入 iframe（避免大报表一次性长任务）
 * - 多尺寸页使用 CSS named pages（@page name + page 属性），混合纸张正确分页
 * - PDF 导出走注入的 exporter（默认实现懒加载 @agile-team/mach-report/pdf，主包零增加）
 */

const YIELD_EVERY_PAGES = 8;

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function pageSizeKey(page: PlanPage): string {
  return `p${page.pageWidthMm}x${page.pageHeightMm}`.replace(/[.+]/g, "_");
}

interface PrintHtmlResult {
  head: string;
  pageChunks: string[];
}

function buildPrintHead(p: RenderPlan): string {
  const sizeKeys = new Map<string, PlanPage>();
  p.pages.forEach((page) => {
    if (!sizeKeys.has(pageSizeKey(page))) sizeKeys.set(pageSizeKey(page), page);
  });
  const pageRules = [...sizeKeys.values()]
    .map(
      (page) =>
        `@page ${pageSizeKey(page)}{size:${page.pageWidthMm}mm ${page.pageHeightMm}mm;margin:0;}`
    )
    .join("\n");
  const css = `.mr-page{margin:0 auto;page-break-after:always;}
.mr-page tr{break-inside:avoid;page-break-inside:avoid;}
.mr-comp{break-inside:avoid;page-break-inside:avoid;}
${pageRules}
body{margin:0;background:#fff;}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>`;
}

function renderPrintPage(page: PlanPage, options?: ReportPrintOptions): string {
  const el = renderPageToDom(page, 96, {}, document);
  el.style.page = pageSizeKey(page);
  const offset = printCalibration(options);
  if (offset.x || offset.y) {
    const content = document.createElement("div");
    content.style.cssText = `position:absolute;inset:0;transform:translate(${offset.x}mm,${offset.y}mm);transform-origin:top left`;
    while (el.firstChild) content.appendChild(el.firstChild);
    el.appendChild(content);
  }
  return el.outerHTML;
}

/** 供 HTML/Word 导出的完整文档；打印路径逐页渲染，避免预先生成所有页。 */
export function buildPrintDocument(p: RenderPlan, options?: ReportPrintOptions): PrintHtmlResult {
  return { head: buildPrintHead(p), pageChunks: p.pages.map(page => renderPrintPage(page, options)) };
}

/**
 * 批量打印（多单连打）：把多份计划合并为一个打印文档——
 * named pages 保证混合纸张正确分页，浏览器只弹一次打印对话框。
 */
export async function printPlans(
  plans: RenderPlan[],
  options: {
    onProgress?: (done: number, total: number) => void;
    onError?: (message: string) => void;
    signal?: AbortSignal;
    printOptions?: ReportPrintOptions;
    messages?: ReportPrintMessages;
  } = {}
): Promise<void> {
  const merged: RenderPlan = {
    schemaVersion: "mach-report-batch-print",
    pages: plans.flatMap((p) => p.pages)
  };
  if (merged.pages.length === 0) return;
  const printOptions = snapshotPrintOptions(options.printOptions);
  const head = buildPrintHead(merged);
  const frame = document.createElement("iframe");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(frame);
  let finished = false;
  try {
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(head);
    for (let i = 0; i < merged.pages.length; i++) {
      assertOutputActive(options.signal);
      doc.write(renderPrintPage(merged.pages[i]!, printOptions));
      if (i % YIELD_EVERY_PAGES === YIELD_EVERY_PAGES - 1) {
        notifyOutputProgress(options, i + 1, merged.pages.length);
        await yieldToBrowser();
      }
    }
    doc.write("</body></html>");
    doc.close();
    await yieldToBrowser();
    await preparePrintResources(doc, printOptions, options.signal);
    notifyOutputProgress(options, merged.pages.length, merged.pages.length);
    finished = true;
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  } catch (error) {
    if (options.signal?.aborted) throw error;
    options.onError?.(printResourceMessage(error, options.messages));
  } finally {
    // 成功路径等打印框关闭后回收；失败立即回收，杜绝 iframe 泄漏
    if (finished) setTimeout(() => frame.remove(), 60_000);
    else frame.remove();
  }
}

/**
 * Word 导出（Word 兼容 HTML，.doc MIME）：
 * 复用打印文档构建（同一样式与 named pages 分页规则），套 Word 命名空间头。
 * Word 2003+ 可直接打开编辑——覆盖"导出可编辑单据"场景，零后端。
 */
function buildWordHead(head: string): string {
  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->${head.replace(/^<!doctype html><html><head>/, "")}`;
}

export function buildWordHtml(p: RenderPlan): { html: string; filename: string } {
  const { head, pageChunks } = buildPrintDocument(p);
  const wordHead = buildWordHead(head);
  return {
    html: `${wordHead}${pageChunks.join("")}</body></html>`,
    filename: "mach-report.doc"
  };
}

export function usePrintExport(
  plan: Ref<RenderPlan | null>,
  hooks: {
    /** 按导出开始时的配置快照处理，避免输出过程中跟随路由配置变化。 */
    getXlsxOptions?: () => XlsxRenderOptions;
    getPrintOptions?: () => ReportPrintOptions;
    getPrintMessages?: () => ReportPrintMessages;
    /** Flush the active editor and await source-backed calculation/persistence before capturing the output plan. */
    beforeOutput?: () => boolean | Promise<boolean>;
    getPdfExporter: () => PdfExporter;
    onError: (message: string, code?: string) => void;
    onWarning?: (message: string) => void;
    onBusy?: (format: string | null) => void;
    onPrinting?: (printing: boolean) => void;
    onTask?: (task: Readonly<ReportPreviewTask>) => void;
    onDiagnostic?: (entry: OutputDiagnostic) => void;
  }
) {
  let printFrame: HTMLIFrameElement | null = null;
  /** 打印进行中标记：重入直接忽略（防连点产生多个打印iframe） */
  let printing = false;
  let disposed = false;
  let planEpoch = 0, outputGeneration = 0;
  const preparingWindows = new Set<Window>();
  const busyTasks = new Map<object, { plan: RenderPlan; epoch: number; format: string; run: OutputRun }>();
  let printRun: OutputRun | null = null;
  const pendingWindows = new Map<Window, { plan: RenderPlan; epoch: number }>();
  let lastBusy: string | null = null;
  /** PDF 字节流在下载和预览之间共享，避免重复生成。 */
  let pdfInFlight: { plan: RenderPlan; epoch: number; promise: Promise<Uint8Array> } | null = null;
  let pdfDownloadInFlight: { plan: RenderPlan; epoch: number; promise: Promise<void>; token: object } | null = null;
  let xlsxInFlight: { plan: RenderPlan; epoch: number; promise: Promise<void>; token: object } | null = null;
  /** 图片导出 in-flight 共享（多页 toBlob 编码不重复触发） */
  let imageInFlight: { plan: RenderPlan; epoch: number; promise: Promise<void>; token: object } | null = null;

  function isActive(p: RenderPlan, epoch: number): boolean {
    return !disposed && plan.value === p && planEpoch === epoch;
  }

  function syncBusy(): void {
    if (disposed) return;
    const format = [...busyTasks.values()].reverse().find((task) => isActive(task.plan, task.epoch))?.format ?? null;
    if (format === lastBusy) return;
    lastBusy = format;
    hooks.onBusy?.(format);
  }

  function beginBusy(p: RenderPlan, epoch: number, format: string): object {
    const token = {};
    busyTasks.set(token, { plan: p, epoch, format, run: createOutputRun("export", hooks.onTask) });
    busyTasks.get(token)!.run.start();
    syncBusy();
    return token;
  }

  function endBusy(token: object): void {
    busyTasks.get(token)?.run.finish();
    busyTasks.delete(token);
    syncBusy();
  }

  function closePendingWindows(): void {
    for (const [win, task] of pendingWindows) {
      if (isActive(task.plan, task.epoch)) continue;
      win.close();
      pendingWindows.delete(win);
    }
  }

  /** A replacement can begin before a new plan exists (for example a fallible Excel import). */
  function invalidatePending(cancelPreparation = true): void {
    if (cancelPreparation) { outputGeneration++; for (const window of preparingWindows) window.close(); preparingWindows.clear(); }
    for (const task of busyTasks.values()) task.run.finish("cancelled");
    printRun?.finish("cancelled");
    planEpoch++;
    releasePrintFrame();
    syncBusy();
    closePendingWindows();
  }

  const stopPlanWatch = watch(plan, () => invalidatePending(false), { flush: "sync" });

  function releasePrintFrame(): void {
    printFrame?.remove();
    printFrame = null;
  }

  /** 卸载后失效所有待完成操作；已打开的 PDF 文档仍可独立使用。 */
  function dispose(): void {
    invalidatePending();
    disposed = true;
    planEpoch++;
    stopPlanWatch();
    releasePrintFrame();
    closePendingWindows();
    busyTasks.clear();
    hooks.onPrinting?.(false);
  }

  function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }
  function downloadForRun(p: RenderPlan, epoch: number, run: OutputRun, blob: Blob, filename: string): void {
    run.update("download");
    // A synchronous task observer may cancel or replace the plan at this boundary.
    if (isActive(p, epoch) && !run.controller.signal.aborted) downloadBlob(blob, filename);
  }

  async function writeFramePages(frame: HTMLIFrameElement, p: RenderPlan, epoch: number, run: OutputRun, options: ReportPrintOptions): Promise<boolean> {
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(buildPrintHead(p));
  // 流式写入：每 YIELD_EVERY_PAGES 页让出主线程一次，避免大报表长任务
  for (let i = 0; i < p.pages.length; i++) {
    if (run.controller.signal.aborted) return false;
    doc.write(renderPrintPage(p.pages[i]!, options));
    run.update("print", i + 1, p.pages.length);
    if (i % YIELD_EVERY_PAGES === YIELD_EVERY_PAGES - 1) await yieldToBrowser();
    if (frame !== printFrame) return false; // 期间被释放（换单据）
  }
  doc.write("</body></html>");
  doc.close();
  await yieldToBrowser();
  await preparePrintResources(doc, options, run.controller.signal);
  if (!isActive(p, epoch) || frame !== printFrame) return false;
    return true;
  }

  function outputReady(): boolean | Promise<boolean> {
    const generation = outputGeneration;
    const active = (success: boolean) => success && !disposed && generation === outputGeneration;
    const failed = (error: unknown) => {
      if (!disposed && generation === outputGeneration) hooks.onError(error instanceof Error ? error.message : "报表修改尚未完成", "export");
      return false;
    };
    try {
      const result = hooks.beforeOutput?.() ?? true;
      return typeof result === "boolean" ? active(result) : result.then(active, failed);
    } catch (error) { return failed(error); }
  }
  function afterOutputReady(operation: () => Promise<void>): Promise<void> {
    const result = outputReady();
    return typeof result === "boolean" ? result ? operation() : Promise.resolve() : result.then((success) => success ? operation() : undefined);
  }

  function failPrint(error: unknown, p: RenderPlan, epoch: number, run: OutputRun, frame: HTMLIFrameElement): void {
    run.finish(run.controller.signal.aborted ? "cancelled" : "failed");
    if (frame === printFrame) releasePrintFrame();
    if (isActive(p, epoch) && !run.controller.signal.aborted) hooks.onError(printResourceMessage(error, hooks.getPrintMessages?.()), "print");
  }
  async function printPrepared(): Promise<void> {
    if (printing) return;
    const p = plan.value;
    if (disposed || !p || p.pages.length === 0) return;
    const epoch = planEpoch;
    printing = true;
    const run = createOutputRun("print", hooks.onTask);
    printRun = run;
    run.start();
    hooks.onPrinting?.(true);
    releasePrintFrame();
    printFrame = document.createElement("iframe");
    printFrame.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(printFrame);
    const frame = printFrame;
    try {
      if (!isActive(p, epoch) || run.controller.signal.aborted) { releasePrintFrame(); return; }
      const options = snapshotPrintOptions(hooks.getPrintOptions?.());
      if (!await writeFramePages(frame, p, epoch, run, options)) return;
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch (error) {
      failPrint(error, p, epoch, run, frame);
    } finally {
      run.finish();
      if (printRun === run) printRun = null;
      printing = false;
      if (!disposed) hooks.onPrinting?.(false);
    }
  }

  function taskOptions(p: RenderPlan, epoch: number, run: OutputRun) {
    return {
      signal: run.controller.signal,
      onDiagnostic: (entry: OutputDiagnostic) => { if (isActive(p, epoch) && !run.controller.signal.aborted) hooks.onDiagnostic?.(entry); },
      onProgress: (done: number, total: number) => run.update("encode", done, total)
    };
  }
  function getPdfBytes(p: RenderPlan, epoch: number, run?: OutputRun): Promise<Uint8Array> {
    if (pdfInFlight?.plan === p && pdfInFlight.epoch === epoch) return pdfInFlight.promise;
    const promise = Promise.resolve().then(() => {
      if (!isActive(p, epoch)) throw new Error("报表已切换或卸载");
      return waitForOutput(hooks.getPdfExporter()(p, (message) => {
        if (isActive(p, epoch)) hooks.onWarning?.(message);
      }, run ? taskOptions(p, epoch, run) : undefined), run?.controller.signal);
    }).finally(() => {
      if (pdfInFlight?.promise === promise) pdfInFlight = null;
    });
    pdfInFlight = { plan: p, epoch, promise };
    return promise;
  }

  async function exportPdf(): Promise<void> {
    const p = plan.value;
    if (disposed || !p || p.pages.length === 0) return;
    const epoch = planEpoch;
    if (pdfDownloadInFlight?.plan === p && pdfDownloadInFlight.epoch === epoch) return pdfDownloadInFlight.promise;
    const token = beginBusy(p, epoch, "PDF");
    const promise = (async () => {
      try {
        const run = busyTasks.get(token)!.run;
        const bytes = await getPdfBytes(p, epoch, run);
        if (!isActive(p, epoch)) return;
        downloadForRun(p, epoch, run, new Blob([bytes as unknown as globalThis.BlobPart], { type: "application/pdf" }), "mach-report.pdf");
      } catch (error) {
        busyTasks.get(token)?.run.finish("failed");
        if (isActive(p, epoch)) hooks.onError(error instanceof Error ? `PDF 导出失败: ${error.message}` : "PDF 导出失败", "pdf");
      } finally {
        endBusy(token);
        if (pdfDownloadInFlight?.token === token) pdfDownloadInFlight = null;
      }
    })();
    pdfDownloadInFlight = { plan: p, epoch, promise, token };
    return promise;
  }

  async function exportXlsx(): Promise<void> {
    const p = plan.value;
    if (disposed || !p || p.pages.length === 0) return;
    const epoch = planEpoch;
    if (xlsxInFlight?.plan === p && xlsxInFlight.epoch === epoch) return xlsxInFlight.promise;
    const xlsxOptions = { ...hooks.getXlsxOptions?.() };
    const token = beginBusy(p, epoch, "Excel");
    const promise = (async () => {
      try {
        const { renderPlanToXlsx } = await import("@agile-team/mach-report/xlsx");
        if (!isActive(p, epoch)) return;
        const run = busyTasks.get(token)!.run;
        const { buffer, warnings } = await waitForOutput(renderPlanToXlsx(p, { ...xlsxOptions, ...taskOptions(p, epoch, run) }), run.controller.signal);
        if (!isActive(p, epoch)) return;
        if (warnings.length > 0) hooks.onWarning?.(`Excel 导出有 ${warnings.length} 条提示：${warnings.slice(0, 2).join("；")}`);
        if (!isActive(p, epoch)) return;
        downloadForRun(p, epoch, run, new Blob([buffer as unknown as globalThis.BlobPart], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        }), "mach-report.xlsx");
      } catch (error) {
        busyTasks.get(token)?.run.finish("failed");
        if (isActive(p, epoch)) hooks.onError(error instanceof Error ? `Excel 导出失败: ${error.message}` : "Excel 导出失败", "export");
      } finally {
        endBusy(token);
        if (xlsxInFlight?.token === token) xlsxInFlight = null;
      }
    })();
    xlsxInFlight = { plan: p, epoch, promise, token };
    return promise;
  }

  /** 导出图片（每页一张，page_N.png；复用位图管线，含并发去重） */
  async function exportPreparedImages(): Promise<void> {
    const p = plan.value;
    if (disposed || !p || p.pages.length === 0) return;
    const epoch = planEpoch;
    if (imageInFlight?.plan === p && imageInFlight.epoch === epoch) return imageInFlight.promise;
    const token = beginBusy(p, epoch, "图片");
    const promise = (async () => {
      try {
        const run = busyTasks.get(token)!.run;
        const { blobs } = await waitForOutput(renderPlanToImages(p, {
          ...taskOptions(p, epoch, run),
          dpr: Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1)
        }), run.controller.signal);
        if (!isActive(p, epoch)) return;
        blobs.forEach((blob, i) => {
          downloadForRun(p, epoch, run, blob, blobs.length > 1 ? `mach-report-page-${i + 1}.png` : "mach-report.png");
        });
      } catch (error) {
        busyTasks.get(token)?.run.finish("failed");
        if (isActive(p, epoch)) hooks.onError(
          error instanceof Error ? `图片导出失败: ${error.message}` : "图片导出失败",
          "export"
        );
      } finally {
        endBusy(token);
        if (imageInFlight?.token === token) imageInFlight = null;
      }
    })();
    imageInFlight = { plan: p, epoch, promise, token };
    return promise;
  }

  async function exportMarkup(format: "html" | "word"): Promise<void> {
    const p = plan.value;
    if (disposed || !p || !p.pages.length) return;
    const epoch = planEpoch;
    const token = beginBusy(p, epoch, format === "word" ? "Word" : "HTML");
    const run = busyTasks.get(token)!.run;
    try {
      const chunks: string[] = [];
      for (const [index, page] of p.pages.entries()) {
        if (!isActive(p, epoch)) return;
        chunks.push(renderPrintPage(page));
        run.update("encode", index + 1, p.pages.length);
        if (index % YIELD_EVERY_PAGES === YIELD_EVERY_PAGES - 1) await yieldToBrowser();
      }
      if (!isActive(p, epoch)) return;
      const head = buildPrintHead(p);
      const html = `${format === "word" ? buildWordHead(head) : head}${chunks.join("")}</body></html>`;
      downloadForRun(p, epoch, run, new Blob([html], { type: format === "word" ? "application/msword;charset=utf-8" : "text/html;charset=utf-8" }), format === "word" ? "mach-report.doc" : "mach-report.html");
    } catch (error) {
      run.finish("failed");
      if (isActive(p, epoch)) hooks.onError(error instanceof Error ? `导出失败: ${error.message}` : "导出失败", "export");
    } finally { endBusy(token); }
  }
  async function exportPreparedWord(): Promise<void> { await exportMarkup("word"); }
  function print(): Promise<void> { return afterOutputReady(printPrepared); }
  function exportImages(): Promise<void> { return afterOutputReady(exportPreparedImages); }
  function exportWord(): Promise<void> { return afterOutputReady(exportPreparedWord); }

  async function exportPreparedAs(format: string): Promise<void> {
    const p = plan.value;
    if (disposed || !p || p.pages.length === 0) return;
    if (format === "pdf") {
      await exportPdf();
      return;
    }
    if (format === "xlsx" || format === "excel") {
      await exportXlsx();
      return;
    }
    if (format === "png" || format === "image") {
      await exportPreparedImages();
      return;
    }
    if (format === "word" || format === "doc") {
      await exportPreparedWord();
      return;
    }
    if (format !== "html") {
      hooks.onError(`不支持的导出格式：${format}`, "export");
      return;
    }
    await exportMarkup("html");
  }

  function exportAs(format: string): Promise<void> { return afterOutputReady(() => exportPreparedAs(format)); }

  function fillPdfWindow(w: Window): void {
    const p = plan.value;
    if (disposed || !p || !p.pages.length) { w.close(); return; }
    const epoch = planEpoch;
    pendingWindows.set(w, { plan: p, epoch });
    const token = beginBusy(p, epoch, "PDF");
    void getPdfBytes(p, epoch, busyTasks.get(token)!.run).then((bytes) => {
      if (!isActive(p, epoch) || w.closed) {
        if (pendingWindows.delete(w)) w.close();
        return;
      }
      const url = URL.createObjectURL(new Blob([bytes as unknown as globalThis.BlobPart], { type: "application/pdf" }));
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const doc = w.document;
      doc.title = "PDF 预览";
      doc.documentElement.style.height = "100%";
      doc.body.style.cssText = "margin:0;height:100%;";
      const viewer = doc.createElement("iframe");
      viewer.title = "PDF 预览";
      viewer.style.cssText = "display:block;width:100%;height:100%;border:0;";
      viewer.src = url;
      doc.body.replaceChildren(viewer);
      pendingWindows.delete(w);
    }).catch((error: unknown) => {
      busyTasks.get(token)?.run.finish("failed");
      w.close();
      pendingWindows.delete(w);
      if (isActive(p, epoch)) hooks.onError(error instanceof Error ? `PDF 预览失败: ${error.message}` : "PDF 预览失败", "pdf");
    }).finally(() => endBusy(token));
  }

  function openPdfWindow(): void {
    if (disposed || !plan.value?.pages.length) return;
    // Preserve the original user gesture even when committing input and recalculating takes time.
    const window = globalThis.window.open("", "_blank");
    if (!window) { hooks.onError("浏览器拦截了弹窗，请允许弹窗后重试", "pdf"); return; }
    const readiness = outputReady();
    if (typeof readiness === "boolean") { if (readiness) fillPdfWindow(window); else window.close(); return; }
    preparingWindows.add(window);
    void readiness.then((ready) => {
      const owned = preparingWindows.delete(window);
      if (!ready || !owned || window.closed) { window.close(); return; }
      fillPdfWindow(window);
    });
  }

  return {
    print,
    exportAs,
    exportImages,
    exportWord,
    openPdfWindow,
    invalidatePending,
    cancel: invalidatePending,
    releasePrintFrame,
    dispose
  };
}
