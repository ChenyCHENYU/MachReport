import type { ComputedRef, InjectionKey } from "vue";
import type { PlanFetcher } from "./adapters";
import type { PdfExporter } from "./pdf-exporter";
import type { MachReportConfig } from "./config";
import type { MachReportController } from "./controller";

/**
 * 注入 key 全部为字符串（而非裸 Symbol）：跨模块联邦边界时宿主与远程
 * 各自打包会生成不同的 Symbol 实例导致 inject 失效；字符串恒等。
 * 保留 InjectionKey 类型以获得类型提示。
 */
export const MACH_REPORT_FETCHER_KEY = "mach-report/fetcher" as unknown as InjectionKey<PlanFetcher>;
export const MACH_REPORT_PDF_EXPORTER_KEY =
  "mach-report/pdf-exporter" as unknown as InjectionKey<PdfExporter>;
export const MACH_REPORT_CONFIG_KEY =
  "mach-report/config" as unknown as InjectionKey<ComputedRef<MachReportConfig | null>>;
export const MACH_REPORT_CONTROLLER_KEY =
  "mach-report/controller" as unknown as InjectionKey<MachReportController>;
