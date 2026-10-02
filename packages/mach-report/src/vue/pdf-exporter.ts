import type { RenderPlan } from "@agile-team/mach-report";

/** PDF 导出器：RenderPlan → PDF 字节；第二参数可上报非致命保真告警。 */
export type PdfExporter = (
  plan: RenderPlan,
  onWarning?: (message: string) => void
) => Promise<Uint8Array>;

export interface DefaultPdfExporterOptions {
  /** 中文字体 URL（浏览器 fetch）；空串跳过字体加载（西文报表） */
  fontUrl: string;
}

/**
 * 默认 PDF 导出器：
 * - 懒加载 @agile-team/mach-report/pdf（含 pdf-lib，只在首次导出时进 bundle）
 * - 字体走 IndexedDB 持久缓存（loadFontWithCache，二次导出零网络）
 */
export function createDefaultPdfExporter(
  options: DefaultPdfExporterOptions = { fontUrl: "/simhei.ttf" }
): PdfExporter {
  let pdfModule: typeof import("@agile-team/mach-report/pdf") | null = null;
  return async (plan, onWarning) => {
    if (!pdfModule) {
      pdfModule = await import("@agile-team/mach-report/pdf");
    }
    const font = options.fontUrl ? await pdfModule.loadFontWithCache(options.fontUrl) : null;
    const { bytes, unsupportedTextCount, pageErrors, fidelityWarnings } =
      await pdfModule.renderPlanToPdf(plan, font ? { customFontBytes: font } : {});
    if (unsupportedTextCount > 0) {
      throw new Error(`PDF 中有 ${unsupportedTextCount} 行文字无法编码；请部署支持所用文字的字体并配置 pdfFontUrl`);
    }
    if (pageErrors.length > 0) {
      throw new Error(`PDF 有 ${pageErrors.length} 页渲染失败：${pageErrors[0]}`);
    }
    if (fidelityWarnings.length > 0) {
      onWarning?.(`PDF 有 ${fidelityWarnings.length} 处版式降级：${fidelityWarnings.slice(0, 2).join("；")}`);
    }
    return bytes;
  };
}
