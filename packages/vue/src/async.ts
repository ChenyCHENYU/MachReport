import { defineAsyncComponent, type App, type Plugin } from "vue";
import { machReportPlugin, type MachReportPluginOptions } from "./plugin";

/**
 * 异步插件入口（@agile-team/mach-report-vue/async）：
 *
 * 首屏敏感页面用异步全局组件代替静态 import——组件与其引擎依赖
 * 拆为独立 chunk，路由级按需加载：
 *
 * ```ts
 * import AsyncMachReportPlugin, { preloadMachReport } from "@agile-team/mach-report-vue/async";
 * app.use(AsyncMachReportPlugin, { baseUrl: "/sub/mach-report" });
 * void preloadMachReport(); // 可选：路由 hover 时预取
 * // 模板：<MachReportPreview temp-id="X" />
 * ```
 */

/** 全局异步组件（懒加载 ReportPreview 及其引擎分片） */
export const MachReportPreview = defineAsyncComponent(() => import("./ReportPreview.vue"));

/** 预取组件分片（路由 hover / 空闲时调用，正式渲染零等待） */
export function preloadMachReport(): Promise<unknown> {
  return import("./ReportPreview.vue");
}

export const machReportAsyncPlugin: Plugin = {
  install(app: App, options: MachReportPluginOptions = {}) {
    // 数据面/PDF 导出器/配置注入与主插件同一实现（均为轻量注册，不含组件代码）
    machReportPlugin.install(app, options);
    app.component("MachReportPreview", MachReportPreview);
  }
};

export default machReportAsyncPlugin;
