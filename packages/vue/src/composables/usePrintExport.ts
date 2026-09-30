import type { Ref } from "vue";
import type { PlanPage, RenderPlan } from "@agile-team/mach-report-core";
import { renderPage as renderPageToDom } from "@agile-team/mach-report-core";
import type { PdfExporter } from "../pdf-exporter";

/**
 * 打印 / 导出 / PDF 窗口。
 *
 * - 打印 HTML 由 DOM 序列化（outerHTML），流式分块写入 iframe（避免大报表一次性长任务）
 * - 多尺寸页使用 CSS named pages（@page name + page 属性），混合纸张正确分页
 * - PDF 导出走注入的 exporter（默认实现懒加载 @agile-team/mach-report-pdf，主包零增加）
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

/** 构建打印文档：head（含按尺寸分组的 @page 规则）+ 每页一段 HTML（供流式写入） */
export function buildPrintDocument(p: RenderPlan): PrintHtmlResult {
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
  const head = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>`;
  const pageChunks = p.pages.map((page) => {
    const el = renderPageToDom(page, 96, {}, document);
    el.style.page = pageSizeKey(page);
    return el.outerHTML;
  });
  return { head, pageChunks };
}

export function usePrintExport(
  plan: Ref<RenderPlan | null>,
  hooks: {
    getPdfExporter: () => PdfExporter;
    onError: (message: string) => void;
  }
) {
  let printFrame: HTMLIFrameElement | null = null;

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
    const p = plan.value;
    if (!p || p.pages.length === 0) return;
    releasePrintFrame();
    const { head, pageChunks } = buildPrintDocument(p);
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
      for (let i = 0; i < pageChunks.length; i++) {
        doc.write(pageChunks[i]!);
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
    }
  }

  async function exportPdf(): Promise<void> {
    const p = plan.value;
    if (!p || p.pages.length === 0) return;
    try {
      const bytes = await hooks.getPdfExporter()(p);
      downloadBlob(new Blob([bytes as unknown as globalThis.BlobPart], { type: "application/pdf" }), "mach-report.pdf");
    } catch (error) {
      hooks.onError(error instanceof Error ? `PDF 导出失败: ${error.message}` : "PDF 导出失败");
    }
  }

  function exportAs(format: string): void {
    const p = plan.value;
    if (!p || p.pages.length === 0) return;
    if (format === "pdf") {
      void exportPdf();
      return;
    }
    const { head, pageChunks } = buildPrintDocument(p);
    const html = `${head}${pageChunks.join("")}</body></html>`;
    downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), `mach-report.${format === "html" ? "html" : format}`);
  }

  function openPdfWindow(): void {
    const p = plan.value;
    if (!p || p.pages.length === 0) return;
    const { head, pageChunks } = buildPrintDocument(p);
    const html = `${head}${pageChunks.join("")}</body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) {
      hooks.onError("浏览器拦截了弹窗，请允许弹窗后重试");
      URL.revokeObjectURL(url);
      return;
    }
    setTimeout(() => w.print(), 400);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return {
    print,
    exportAs,
    openPdfWindow,
    releasePrintFrame
  };
}
