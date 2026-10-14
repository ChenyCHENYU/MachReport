import { computed, inject, shallowRef, type ComputedRef } from "vue";
import { MACH_REPORT_CONTROLLER_KEY } from "./injection-keys";
import { MachReportError } from "./errors";

/**
 * ReportPreview 的编程式控制器（与组件 ref 方法同面）：
 * reload / print / exportAs / openPdfWindow / gotoPage / setParams。
 */
export interface MachReportController {
  reload(): Promise<void>;
  print(): Promise<void>;
  /** 支持 html/pdf/xlsx/png/word（excel/image/doc 为兼容别名）；未知格式报 export 错误。 */
  exportAs(format: string): Promise<void> | void;
  openPdfWindow(): void;
  gotoPage(page: number): void;
  /** 编程式设置参数并查询（合并进面板值；opts.reload=false 仅设值不重载） */
  setParams(values: Record<string, string>, opts?: { reload?: boolean }): Promise<void> | void;
}

/** 父组件使用的稳定句柄；ref 回调直接绑定到预览组件。 */
export interface MachReportHandle extends MachReportController {
  ref(instance: unknown): void;
  readonly ready: ComputedRef<boolean>;
  exportAs(format: string): Promise<void>;
  setParams(values: Record<string, string>, opts?: { reload?: boolean }): Promise<void>;
}

/**
 * 父组件统一入口，无需手写组件实例类型或可选链：
 * `const report = useMachReport()` → `<MachReportPreview :ref="report.ref" />`。
 * 异步组件挂载前/卸载后调用会报告 config 错误；ready 可控制按钮状态。
 */
export function useMachReport(): MachReportHandle {
  const instance = shallowRef<MachReportController | null>(null);
  function getController(): MachReportController {
    if (!instance.value) {
      throw new MachReportError("config", "报表预览尚未挂载，请在 ready 后调用控制器");
    }
    return instance.value;
  }
  return {
    ref(value: unknown): void {
      const candidate = value as Partial<MachReportController> | null;
      instance.value = candidate
        && typeof candidate.reload === "function"
        && typeof candidate.print === "function"
        && typeof candidate.exportAs === "function"
        && typeof candidate.openPdfWindow === "function"
        && typeof candidate.gotoPage === "function"
        && typeof candidate.setParams === "function"
        ? candidate as MachReportController
        : null;
    },
    ready: computed(() => instance.value !== null),
    async reload(): Promise<void> { await getController().reload(); },
    async print(): Promise<void> { await getController().print(); },
    async exportAs(format: string): Promise<void> { await getController().exportAs(format); },
    openPdfWindow(): void { getController().openPdfWindow(); },
    gotoPage(page: number): void { getController().gotoPage(page); },
    async setParams(values: Record<string, string>, opts?: { reload?: boolean }): Promise<void> {
      await getController().setParams(values, opts);
    }
  };
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
