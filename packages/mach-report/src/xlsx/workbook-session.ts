import type * as ExcelJS from "exceljs";
import { assertOutputActive, forwardOutputAbort } from "../output/progress";
import { importLoadedWorkbook, inspectLoadedWorkbook, loadImportWorkbook, type ExcelWorkbookInspection } from "./import-template";
import { ImportWarnings, resolveImportOptions, type ExcelImportOptions, type ExcelImportResult } from "./import-types";

/** Parsing budgets are fixed at open; selections can change without reopening the workbook. */
export type ExcelWorkbookSelectionOptions = Omit<ExcelImportOptions, "limits">;
export interface ExcelWorkbookSession {
  readonly disposed: boolean;
  inspect(): ExcelWorkbookInspection;
  importTemplate(options?: ExcelWorkbookSelectionOptions): Promise<ExcelImportResult>;
  dispose(): void;
}

/** One bounded workbook per owner. The caller releases it when replacing input or unmounting. */
export async function openExcelWorkbook(input: ArrayBuffer | Uint8Array | Blob, options: ExcelImportOptions = {}): Promise<ExcelWorkbookSession> {
  const warnings = new ImportWarnings();
  const loaded = await loadImportWorkbook(input, options, warnings);
  let workbook: ExcelJS.Workbook | undefined = loaded.workbook;
  let busy = false;
  const lifetime = new AbortController();
  const defaults = {
    ...options, limits: { ...loaded.resolved.limits },
    sheets: options.sheets ? [...options.sheets] : undefined,
    range: typeof options.range === "object" ? { ...options.range } : options.range,
    signal: undefined,
  };
  function current(): ExcelJS.Workbook {
    if (!workbook) throw new Error("Excel 工作簿会话已释放，请重新导入");
    return workbook;
  }
  return {
    get disposed() { return workbook === undefined; },
    inspect: () => inspectLoadedWorkbook(current(), defaults, warnings),
    importTemplate: async (selection = {}) => {
      if (busy) throw new Error("Excel 会话正在转换，请等待当前操作或取消后重试");
      if (Object.prototype.hasOwnProperty.call(selection, "limits")) throw new Error("Excel 会话预算应在 openExcelWorkbook 时配置");
      const source = current(), controller = new AbortController();
      const detachLifetime = forwardOutputAbort(lifetime.signal, controller);
      const detachSelection = forwardOutputAbort(selection.signal, controller);
      busy = true;
      try {
        const selected = { ...defaults, ...selection, signal: controller.signal };
        const result = await importLoadedWorkbook(source, selected, resolveImportOptions(selected), newWarnings(warnings));
        assertOutputActive(controller.signal);
        current();
        return result;
      } finally {
        detachLifetime(); detachSelection(); busy = false;
      }
    },
    dispose: () => { workbook = undefined; lifetime.abort(); },
  };
}

function newWarnings(source: ImportWarnings): ImportWarnings {
  const warnings = new ImportWarnings();
  source.result().forEach((message) => warnings.add(message));
  return warnings;
}
