import type { RenderPlan } from "@agile-team/mach-report-core";

/** PDF 导出器：RenderPlan → PDF 字节。宿主可注入自定义实现（自研后端/Worker 化等）。 */
export type PdfExporter = (plan: RenderPlan) => Promise<Uint8Array>;

export interface DefaultPdfExporterOptions {
  /** 中文字体 URL（浏览器 fetch）；空串跳过字体加载（西文报表） */
  fontUrl: string;
}

/**
 * 默认 PDF 导出器：
 * - 懒加载 @agile-team/mach-report-pdf（含 pdf-lib，只在首次导出时进 bundle）
 * - 字体走 IndexedDB 持久缓存（loadFontWithCache，二次导出零网络）
 */
export function createDefaultPdfExporter(
  options: DefaultPdfExporterOptions = { fontUrl: "/simhei.ttf" }
): PdfExporter {
  let pdfModule: typeof import("@agile-team/mach-report-pdf") | null = null;
  return async (plan) => {
    if (!pdfModule) {
      pdfModule = await import("@agile-team/mach-report-pdf");
    }
    const font = options.fontUrl ? await pdfModule.loadFontWithCache(options.fontUrl) : null;
    const { bytes } = await pdfModule.renderPlanToPdf(plan, font ? { customFontBytes: font } : {});
    return bytes;
  };
}
