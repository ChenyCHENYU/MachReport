import type { App } from "vue";
import { computed } from "vue";
import type { PlanFetcher } from "./adapters";
import { createFetchRequest, createJh4jGridPlanFetcher, type HostRequest } from "./adapters";
import type { PdfExporter } from "./pdf-exporter";
import { createDefaultPdfExporter } from "./pdf-exporter";
import {
  MACH_REPORT_CONFIG_KEY,
  MACH_REPORT_FETCHER_KEY,
  MACH_REPORT_PDF_EXPORTER_KEY
} from "./injection-keys";
import type { MachReportConfig } from "./config";

export interface MachReportPluginOptions {
  /**
   * 数据面（全部可选——零配置时用全局 fetch 同源直连）：
   * - request：宿主 http 客户端（axios 风格签名）
   * - fetcher：完整 PlanFetcher（自定义数据面/本地模板，优先级最高）
   */
  request?: HostRequest;
  baseUrl?: string;
  fetcher?: PlanFetcher;
  /** 应用级配置中心（defaults/presets/文案/主题），见 defineMachReportConfig */
  config?: MachReportConfig;
  /** PDF 导出字体 URL（默认 /simhei.ttf；'' 跳过字体） */
  pdfFontUrl?: string;
  /** 自定义 PDF 导出器（缺省用懒加载引擎 /pdf 子路径的默认实现） */
  pdfExporter?: PdfExporter;
}

/**
 * Vue 插件（零配置可用）：
 *
 * ```ts
 * app.use(machReportPlugin)                              // 同源 jh4j 部署，零胶水
 * app.use(machReportPlugin, { baseUrl: "/sub/mach-report" })
 * app.use(machReportPlugin, { request: axios, config: defineMachReportConfig({...}) })
 * ```
 *
 * 之后业务页面一行使用：`<ReportPreview temp-id="X" />`
 */
export const machReportPlugin = {
  install(app: App, options: MachReportPluginOptions = {}): void {
    // 数据面：fetcher > request > 内置 fetch 同源适配（零配置路径）
    const fetcher =
      options.fetcher ??
      createJh4jGridPlanFetcher({
        request: options.request ?? createFetchRequest({ baseUrl: options.baseUrl }),
        baseUrl: options.baseUrl
      });
    app.provide(MACH_REPORT_FETCHER_KEY, fetcher);

    const pdfFontUrl = options.pdfFontUrl ?? options.config?.defaults?.pdfFontUrl ?? "/simhei.ttf";
    app.provide(
      MACH_REPORT_PDF_EXPORTER_KEY,
      options.pdfExporter ?? createDefaultPdfExporter({ fontUrl: pdfFontUrl })
    );

    // 配置中心以响应式 ref 注入（路由级 provideMachReportConfig 可叠加）
    app.provide(MACH_REPORT_CONFIG_KEY, computed(() => options.config ?? null));
  }
};
