import { computed, inject, shallowRef, type ComputedRef } from "vue";
import { MACH_REPORT_CONTROLLER_KEY } from "./injection-keys";
import { MachReportError } from "./errors";
import type { MachReportErrorCode } from "./errors";
import type { PdfFontCheckResult } from "./pdf-exporter";
import type { RenderPlan, ReportCellEdit } from "@agile-team/mach-report";
import type { ExcelImportOptions, ExcelImportResult } from "../xlsx/import-types";

export interface MachReportStateError {
  message: string;
  code: MachReportErrorCode;
  cause?: unknown;
}

/** 只读快照，由组件的同一套状态驱动；无需通过事件另建状态。 */
export interface MachReportState {
  readonly loading: boolean;
  readonly hasPlan: boolean;
  readonly pageCount: number;
  readonly currentPage: number;
  /** 当前导出显示名称，空闲时为 null。 */
  readonly exporting: string | null;
  readonly printing: boolean;
  readonly canExport: boolean;
  readonly canPrint: boolean;
  readonly error: Readonly<MachReportStateError> | null;
  readonly pdfFont: Readonly<PdfFontCheckResult>;
  readonly editing?: boolean;
  readonly saving?: boolean;
  readonly importing?: boolean;
  readonly dirty?: boolean;
}

const EMPTY_STATE: MachReportState = Object.freeze({
  loading: false, hasPlan: false, pageCount: 0, currentPage: 1,
  exporting: null, printing: false, canExport: false, canPrint: false, error: null,
  pdfFont: Object.freeze({ status: "unchecked", fontUrl: "" })
});

/**
 * ReportPreview 的编程式控制器（与组件 ref 方法同面）：
 * reload / print / exportAs / openPdfWindow / gotoPage / setParams。
 */
export interface MachReportController {
  /** 新组件提供；可选以兼容旧自定义控制器。 */
  readonly state?: MachReportState;
  checkPdfFont?(): Promise<PdfFontCheckResult>;
  reload(): Promise<void>;
  print(): Promise<void>;
  /** 支持 html/pdf/xlsx/png/word（excel/image/doc 为兼容别名）；未知格式报 export 错误。 */
  exportAs(format: string): Promise<void> | void;
  openPdfWindow(): void;
  gotoPage(page: number): void;
  /** 编程式设置参数并查询（合并进面板值；opts.reload=false 仅设值不重载） */
  setParams(values: Record<string, string>, opts?: { reload?: boolean }): Promise<void> | void;
  /** Explicit import does not require the toolbar excelImport option. No host APIs are called. */
  importExcel?(input: ArrayBuffer | Uint8Array | Blob, options?: ExcelImportOptions): Promise<ExcelImportResult | null>;
  /** Copies prevent consumers from mutating the preview's current snapshot. */
  getPlan?(): RenderPlan | null;
  getChanges?(): ReportCellEdit[];
}

/** 父组件使用的稳定句柄；ref 回调直接绑定到预览组件。 */
export interface MachReportHandle extends MachReportController {
  ref(instance: unknown): void;
  readonly ready: ComputedRef<boolean>;
  readonly state: MachReportState;
  checkPdfFont(): Promise<PdfFontCheckResult>;
  exportAs(format: string): Promise<void>;
  setParams(values: Record<string, string>, opts?: { reload?: boolean }): Promise<void>;
  importExcel(input: ArrayBuffer | Uint8Array | Blob, options?: ExcelImportOptions): Promise<ExcelImportResult | null>;
  getPlan(): RenderPlan | null;
  getChanges(): ReportCellEdit[];
}

/**
 * 父组件统一入口，无需手写组件实例类型或可选链：
 * `const report = useMachReport()` → `<MachReportPreview :ref="report.ref" />`。
 * 异步组件挂载前/卸载后调用会报告 config 错误；ready 可控制按钮状态。
 */
export function useMachReport(): MachReportHandle {
  const instance = shallowRef<MachReportController | null>(null);
  const currentState = (): MachReportState => instance.value?.state ?? EMPTY_STATE;
  // 固定对象 + 只读 getter，支持 const { state } = report，挂载/卸载后仍实时读取。
  const state: MachReportState = Object.freeze({
    get loading() { return currentState().loading; },
    get hasPlan() { return currentState().hasPlan; },
    get pageCount() { return currentState().pageCount; },
    get currentPage() { return currentState().currentPage; },
    get exporting() { return currentState().exporting; },
    get printing() { return currentState().printing; },
    get canExport() { return currentState().canExport; },
    get canPrint() { return currentState().canPrint; },
    get error() { return currentState().error; },
    get pdfFont() { return currentState().pdfFont; },
    get editing() { return currentState().editing ?? false; },
    get saving() { return currentState().saving ?? false; },
    get importing() { return currentState().importing ?? false; },
    get dirty() { return currentState().dirty ?? false; }
  });
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
    state,
    async checkPdfFont(): Promise<PdfFontCheckResult> {
      const controller = getController();
      if (!controller.checkPdfFont) return { status: "unverified", fontUrl: "", message: "旧自定义控制器未提供字体检查，请由宿主确认字体配置" };
      return controller.checkPdfFont();
    },
    async reload(): Promise<void> { await getController().reload(); },
    async print(): Promise<void> { await getController().print(); },
    async exportAs(format: string): Promise<void> { await getController().exportAs(format); },
    openPdfWindow(): void { getController().openPdfWindow(); },
    gotoPage(page: number): void { getController().gotoPage(page); },
    async setParams(values: Record<string, string>, opts?: { reload?: boolean }): Promise<void> {
      await getController().setParams(values, opts);
    },
    async importExcel(input, options): Promise<ExcelImportResult | null> {
      const controller = getController();
      if (!controller.importExcel) throw new MachReportError("config", "旧自定义控制器未提供 Excel 导入");
      return controller.importExcel(input, options);
    },
    getPlan(): RenderPlan | null {
      return getController().getPlan?.() ?? null;
    },
    getChanges(): ReportCellEdit[] {
      return getController().getChanges?.() ?? [];
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
