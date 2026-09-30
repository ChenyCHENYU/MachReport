import { inject } from "vue";
import { MACH_REPORT_CONTROLLER_KEY } from "./injection-keys";

/**
 * ReportPreview 的编程式控制器（与组件 ref 方法同面）：
 * reload / print / exportAs / openPdfWindow / gotoPage。
 */
export interface MachReportController {
  reload(): Promise<void>;
  print(): Promise<void>;
  exportAs(format: "html" | "pdf" | string): void;
  openPdfWindow(): void;
  gotoPage(page: number): void;
}

/**
 * 在 ReportPreview 的任意后代组件中获取控制器（免模板 ref）：
 *
 * ```vue
 * <script setup>
 * import { useReportPreview } from "@agile-team/mach-report/vue";
 * const preview = useReportPreview();
 * </script>
 * <template><button @click="preview?.print()">打印本单</button></template>
 *
 * 不在预览组件内调用时返回 null（不抛错，便于条件渲染场景）。
 */
export function useReportPreview(): MachReportController | null {
  return inject(MACH_REPORT_CONTROLLER_KEY, null);
}
