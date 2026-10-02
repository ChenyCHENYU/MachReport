import type { Ref } from "vue";
import type { PlanPage, RenderPlan } from "@agile-team/mach-report";
import {
  renderPage as renderPageToDom,
  renderPlanToImages
} from "@agile-team/mach-report";
import type { PdfExporter } from "../pdf-exporter";

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
  return `p${Math.round(page.pageWidthMm)}x${Math.round(page.pageHeightMm)}`;
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
        `@page ${pageSizeKey(page)}{size:${Math.round(page.pageWidthMm)}mm ${Math.round(page.pageHeightMm)}mm;margin:0;}`
    )
    .join("\n");
  const css = `.mr-page{margin:0 auto;page-break-after:always;}
.mr-page tr{break-inside:avoid;page-break-inside:avoid;}
.mr-comp{break-inside:avoid;page-break-inside:avoid;}
${pageRules}
body{margin:0;background:#fff;}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>`;
}

function renderPrintPage(page: PlanPage): string {
  const el = renderPageToDom(page, 96, {}, document);
  el.style.page = pageSizeKey(page);
  return el.outerHTML;
}

/** 供 HTML/Word 导出的完整文档；打印路径逐页渲染，避免预先生成所有页。 */
export function buildPrintDocument(p: RenderPlan): PrintHtmlResult {
  return { head: buildPrintHead(p), pageChunks: p.pages.map(renderPrintPage) };
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
  } = {}
): Promise<void> {
  const merged: RenderPlan = {
    schemaVersion: "mach-report-batch-print",
    pages: plans.flatMap((p) => p.pages)
  };
  if (merged.pages.length === 0) return;
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
      doc.write(renderPrintPage(merged.pages[i]!));
      if (i % YIELD_EVERY_PAGES === YIELD_EVERY_PAGES - 1) {
        options.onProgress?.(i + 1, merged.pages.length);
        await yieldToBrowser();
      }
    }
    doc.write("</body></html>");
    doc.close();
    await yieldToBrowser();
    options.onProgress?.(merged.pages.length, merged.pages.length);
    finished = true;
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  } catch (error) {
    options.onError?.(error instanceof Error ? `批量打印失败: ${error.message}` : "批量打印失败");
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
export function buildWordHtml(p: RenderPlan): { html: string; filename: string } {
  const { head, pageChunks } = buildPrintDocument(p);
  // Word 头：office 命名空间 + Print 视图（所见即所得，保留 @page 尺寸）
  const wordHead = `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->${head.replace(/^<!doctype html><html><head>/, "")}`;
  return {
    html: `${wordHead}${pageChunks.join("")}</body></html>`,
    filename: "mach-report.doc"
  };
}

export function usePrintExport(
  plan: Ref<RenderPlan | null>,
  hooks: {
    getPdfExporter: () => PdfExporter;
    onError: (message: string, code?: string) => void;
    onWarning?: (message: string) => void;
    onBusy?: (format: string | null) => void;
  }
) {
  let printFrame: HTMLIFrameElement | null = null;
  /** 打印进行中标记：重入直接忽略（防连点产生多个打印iframe） */
  let printing = false;
  /** PDF 字节流在下载和预览之间共享，避免重复生成。 */
  let pdfInFlight: { plan: RenderPlan; promise: Promise<Uint8Array> } | null = null;
  let pdfDownloadInFlight: { plan: RenderPlan; promise: Promise<void>; token: object } | null = null;
  /** 图片导出 in-flight 共享（多页 toBlob 编码不重复触发） */
  let imageInFlight: { plan: RenderPlan; promise: Promise<void>; token: object } | null = null;

  function releasePrintFrame(): void {
    printFrame?.remove();
    printFrame = null;
  }

  function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function print(): Promise<void> {
    if (printing) return;
    const p = plan.value;
    if (!p || p.pages.length === 0) return;
    printing = true;
    releasePrintFrame();
    const head = buildPrintHead(p);
    printFrame = document.createElement("iframe");
    printFrame.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(printFrame);
    const frame = printFrame;
    try {
      const doc = frame.contentDocument!;
      doc.open();
      doc.write(head);
      // 流式写入：每 YIELD_EVERY_PAGES 页让出主线程一次，避免大报表长任务
      for (let i = 0; i < p.pages.length; i++) {
        doc.write(renderPrintPage(p.pages[i]!));
        if (i % YIELD_EVERY_PAGES === YIELD_EVERY_PAGES - 1) await yieldToBrowser();
        if (frame !== printFrame) return; // 期间被释放（换单据）
      }
      doc.write("</body></html>");
      doc.close();
      await yieldToBrowser();
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      hooks.onError("调用打印失败，请改用导出 PDF");
    } finally {
      printing = false;
    }
  }

  function getPdfBytes(p: RenderPlan): Promise<Uint8Array> {
    if (pdfInFlight?.plan === p) return pdfInFlight.promise;
    const promise = hooks.getPdfExporter()(p, hooks.onWarning).finally(() => {
      if (pdfInFlight?.promise === promise) pdfInFlight = null;
    });
    pdfInFlight = { plan: p, promise };
    return promise;
  }

  async function exportPdf(): Promise<void> {
    const p = plan.value;
    if (!p || p.pages.length === 0) return;
    if (pdfDownloadInFlight?.plan === p) return pdfDownloadInFlight.promise;
    hooks.onBusy?.("PDF");
    const token = {};
    const promise = (async () => {
      try {
        const bytes = await getPdfBytes(p);
        if (plan.value !== p) return;
        downloadBlob(new Blob([bytes as unknown as globalThis.BlobPart], { type: "application/pdf" }), "mach-report.pdf");
      } catch (error) {
        hooks.onError(error instanceof Error ? `PDF 导出失败: ${error.message}` : "PDF 导出失败", "pdf");
      } finally {
        hooks.onBusy?.(null);
        if (pdfDownloadInFlight?.token === token) pdfDownloadInFlight = null;
      }
    })();
    pdfDownloadInFlight = { plan: p, promise, token };
    return promise;
  }

  async function exportXlsx(): Promise<void> {
    const p = plan.value;
    if (!p || p.pages.length === 0) return;
    hooks.onBusy?.("Excel");
    try {
      const { renderPlanToXlsx } = await import("@agile-team/mach-report/xlsx");
      const { buffer, warnings } = await renderPlanToXlsx(p);
      if (plan.value !== p) return;
      if (warnings.length > 0) hooks.onWarning?.(`Excel 有 ${warnings.length} 处内容未导出：${warnings.slice(0, 2).join("；")}`);
      downloadBlob(new Blob([buffer as unknown as globalThis.BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }), "mach-report.xlsx");
    } catch (error) {
      hooks.onError(error instanceof Error ? `Excel 导出失败: ${error.message}` : "Excel 导出失败", "export");
    } finally {
      hooks.onBusy?.(null);
    }
  }

  /** 导出图片（每页一张，page_N.png；复用位图管线，含并发去重） */
  async function exportImages(): Promise<void> {
    const p = plan.value;
    if (!p || p.pages.length === 0) return;
    if (imageInFlight?.plan === p) return imageInFlight.promise;
    hooks.onBusy?.("图片");
    const token = {};
    const promise = (async () => {
      try {
        const { blobs } = await renderPlanToImages(p, {
          dpr: Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1)
        });
        if (plan.value !== p) return;
        blobs.forEach((blob, i) => {
          downloadBlob(blob, blobs.length > 1 ? `mach-report-page-${i + 1}.png` : "mach-report.png");
        });
      } catch (error) {
        hooks.onError(
          error instanceof Error ? `图片导出失败: ${error.message}` : "图片导出失败",
          "export"
        );
      } finally {
        hooks.onBusy?.(null);
        if (imageInFlight?.token === token) imageInFlight = null;
      }
    })();
    imageInFlight = { plan: p, promise, token };
    return promise;
  }

  /** 导出 Word（可编辑 .doc，零后端） */
  function exportWord(): void {
    const p = plan.value;
    if (!p || p.pages.length === 0) return;
    try {
      const { html, filename } = buildWordHtml(p);
      downloadBlob(new Blob([html], { type: "application/msword;charset=utf-8" }), filename);
    } catch (error) {
      hooks.onError(
        error instanceof Error ? `Word 导出失败: ${error.message}` : "Word 导出失败",
        "export"
      );
    }
  }

  function exportAs(format: string): void {
    const p = plan.value;
    if (!p || p.pages.length === 0) return;
    if (format === "pdf") {
      void exportPdf();
      return;
    }
    if (format === "xlsx" || format === "excel") {
      void exportXlsx();
      return;
    }
    if (format === "png" || format === "image") {
      void exportImages();
      return;
    }
    if (format === "word" || format === "doc") {
      exportWord();
      return;
    }
    if (format !== "html") {
      hooks.onError(`不支持的导出格式：${format}`, "export");
      return;
    }
    const { head, pageChunks } = buildPrintDocument(p);
    const html = `${head}${pageChunks.join("")}</body></html>`;
    downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), "mach-report.html");
  }

  function openPdfWindow(): void {
    const p = plan.value;
    if (!p || p.pages.length === 0) return;
    // 先同步打开空窗口，避免异步生成 PDF 后被浏览器当成弹窗拦截。
    const w = window.open("", "_blank");
    if (!w) {
      hooks.onError("浏览器拦截了弹窗，请允许弹窗后重试");
      return;
    }
    void getPdfBytes(p).then((bytes) => {
      if (plan.value !== p) {
        w.close();
        return;
      }
      const url = URL.createObjectURL(new Blob([bytes as unknown as globalThis.BlobPart], { type: "application/pdf" }));
      const doc = w.document;
      doc.title = "PDF 预览";
      doc.documentElement.style.height = "100%";
      doc.body.style.cssText = "margin:0;height:100%;";
      const viewer = doc.createElement("iframe");
      viewer.title = "PDF 预览";
      viewer.style.cssText = "display:block;width:100%;height:100%;border:0;";
      viewer.src = url;
      doc.body.replaceChildren(viewer);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }).catch((error: unknown) => {
      w.close();
      hooks.onError(error instanceof Error ? `PDF 预览失败: ${error.message}` : "PDF 预览失败", "pdf");
    });
  }

  return {
    print,
    exportAs,
    exportImages,
    exportWord,
    openPdfWindow,
    releasePrintFrame
  };
}
