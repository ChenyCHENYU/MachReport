import type { App } from "vue";
import type { PlanFetcher } from "./adapters";
import { createJh4jGridPlanFetcher } from "./adapters";
import type { PdfExporter } from "./pdf-exporter";
import { createDefaultPdfExporter } from "./pdf-exporter";
import { MACH_REPORT_FETCHER_KEY, MACH_REPORT_PDF_EXPORTER_KEY } from "./injection-keys";

export interface MachReportPluginOptions {
  /**
   * 数据面（优先级：fetcher > request）：
   * - request：宿主 http 客户端（axios 风格签名），内部组装 jh4j gridPlan 请求
   * - fetcher：完整 PlanFetcher（自定义数据面/本地模板）
   */
  request?: (config: {
    url: string;
    method: string;
    params?: Record<string, string>;
  }) => Promise<unknown>;
  baseUrl?: string;
  fetcher?: PlanFetcher;
  /** PDF 导出字体 URL（默认 /simhei.ttf；'' 跳过字体，走内置西文字体） */
  pdfFontUrl?: string;
  /** 自定义 PDF 导出器（缺省用懒加载 @mach-report/pdf 的默认实现） */
  pdfExporter?: PdfExporter;
}

/**
 * Vue 插件：一次注册全局数据面与导出器，业务侧收敛为一行
 * `<ReportPreview temp-id="X" />`（fetcher 未传 prop 时自动落到注入值）。
 *
 * ```ts
 * app.use(machReportPlugin, { request: axios, baseUrl: "/sub/mach-report" })
 * ```
 */
export const machReportPlugin = {
  install(app: App, options: MachReportPluginOptions = {}): void {
    const fetcher =
      options.fetcher ??
      (options.request
        ? createJh4jGridPlanFetcher({ request: options.request, baseUrl: options.baseUrl })
        : undefined);
    if (fetcher) app.provide(MACH_REPORT_FETCHER_KEY, fetcher);
    app.provide(
      MACH_REPORT_PDF_EXPORTER_KEY,
      options.pdfExporter ??
        createDefaultPdfExporter({ fontUrl: options.pdfFontUrl ?? "/simhei.ttf" })
    );
  }
};
