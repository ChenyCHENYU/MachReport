import { inject } from "vue";
import { MACH_REPORT_CONTROLLER_KEY } from "./injection-keys";

/**
 * ReportPreview 的编程式控制器（与组件 ref 方法同面）：
 * reload / print / exportAs / openPdfWindow / gotoPage / setParams。
 */
export interface MachReportController {
  reload(): Promise<void>;
  print(): Promise<void>;
  /** 支持 html/pdf/xlsx/png/word（excel/image/doc 为兼容别名）；未知格式报 export 错误。 */
  exportAs(format: string): void;
  openPdfWindow(): void;
  gotoPage(page: number): void;
  /** 编程式设置参数并查询（合并进面板值；opts.reload=false 仅设值不重载） */
  setParams(values: Record<string, string>, opts?: { reload?: boolean }): void;
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
