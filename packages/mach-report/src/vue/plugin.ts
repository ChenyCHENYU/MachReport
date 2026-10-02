import type { App } from "vue";
import { computed, defineAsyncComponent } from "vue";
import type { PlanFetcher } from "./adapters";
import type { PdfExporter } from "./pdf-exporter";
import {
  MACH_REPORT_CONFIG_KEY,
  MACH_REPORT_FETCHER_KEY,
  MACH_REPORT_PDF_EXPORTER_KEY
} from "./injection-keys";
import type { MachReportConfig } from "./config";

/**
 * 全局组件（懒加载分片：首次渲染才拉取组件与引擎依赖，
 * 与局部 import 等价——首屏敏感页面零额外成本）
 */
export const MachReportPreview = defineAsyncComponent(() => import("./ReportPreview.vue"));

export interface MachReportPluginOptions {
  /** 报表数据源；也可直接传给 ReportPreview 的 fetcher prop */
  fetcher?: PlanFetcher;
  /** 应用级配置中心（defaults/presets/文案/主题），见 defineMachReportConfig */
  config?: MachReportConfig;
  /** PDF 导出字体 URL（默认 /simhei.ttf；'' 跳过字体） */
  pdfFontUrl?: string;
  /** 自定义 PDF 导出器（缺省用懒加载引擎 /pdf 子路径的默认实现） */
  pdfExporter?: PdfExporter;
  /** 注册全局组件 <MachReportPreview>（默认 true；懒加载分片不影响首屏） */
  globalComponent?: boolean;
}

/**
 * Vue 插件：注册组件、配置和可选的数据源，不绑定任何后端接口。
 *
 * ```ts
 * app.use(machReportPlugin, { fetcher })
 * app.use(machReportPlugin, { config: defineMachReportConfig({...}) })
 * ```
 *
 * 之后业务模板直接写 `<MachReportPreview report-id="X" />`。
 */
export const machReportPlugin = {
  install(app: App, options: MachReportPluginOptions = {}): void {
    if (options.fetcher) app.provide(MACH_REPORT_FETCHER_KEY, options.fetcher);

    if (options.pdfExporter) app.provide(MACH_REPORT_PDF_EXPORTER_KEY, options.pdfExporter);

    // 配置中心以响应式 ref 注入（路由级 provideMachReportConfig 可叠加）
    app.provide(MACH_REPORT_CONFIG_KEY, computed(() => {
      if (options.pdfFontUrl === undefined) return options.config ?? null;
      const config = options.config ?? { defaults: {}, presets: {} };
      return { ...config, defaults: { ...config.defaults, pdfFontUrl: options.pdfFontUrl } };
    }));

    if (options.globalComponent !== false) {
      app.component("MachReportPreview", MachReportPreview);
    }
  }
};
