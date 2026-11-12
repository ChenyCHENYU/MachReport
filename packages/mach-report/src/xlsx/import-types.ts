import { createDiagnosticCollector, DEFAULT_DIAGNOSTIC_LIMIT, type DiagnosticSummary } from "../output/diagnostic-collector";
import type { OutputTaskOptions } from "../output/progress";
import type { ReportTemplate } from "../layout/paginate";

/** Limits apply to the selected rectangular ranges, including their empty cells. */
export interface ExcelImportLimits {
  /** Compressed input, default 20 MiB. */
  maxFileBytes?: number;
  /** Declared ZIP uncompressed total, default 64 MiB. */
  maxUncompressedBytes?: number;
  /** Total selected cells across sheets, default 250,000; hard ceiling 1,000,000. */
  maxCells?: number;
  /** Rows per selected sheet, default 100,000; hard ceiling 1,048,576. */
  maxRows?: number;
  /** Columns per selected sheet, default 2,048; hard ceiling 16,384. */
  maxColumns?: number;
  /** Workbook sheets, default 32. */
  maxSheets?: number;
}

export interface ExcelImportOptions extends OutputTaskOptions {
  /** Sheet names or one-based workbook positions. Default: all visible sheets. */
  sheets?: Array<string | number>;
  /** A1 range for every sheet, or ranges keyed by exact sheet name. */
  range?: string | Record<string, string>;
  /** Wide preserves natural column widths. A3/A4 scale the complete width to paper. */
  layout?: "wide" | "a3" | "a4";
  /** Only applies to A3/A4; default landscape. */
  landscape?: boolean;
  /** Vertical preview segment limit, default 80, maximum 200. Merges remain intact. */
  maxRowsPerPage?: number;
  /** Optional resource limits; hard ceilings prevent unbounded allocations. */
  limits?: ExcelImportLimits;
}

export interface ExcelImportedSheet {
  name: string;
  /** Original, one-based workbook position. */
  index: number;
  range: string;
  rowCount: number;
  columnCount: number;
  /** Zero-based index into template.pages. */
  pageStart: number;
  pageCount: number;
}

export type ExcelImportDiagnosticCode =
  | "formula-shared" | "formula-cached" | "formula-result-missing" | "number-format"
  | "date-readonly" | "date-epoch" | "literal-placeholder" | "style-color" | "style-fill"
  | "style-border" | "style-alignment" | "font-decoration" | "rich-text-color" | "rich-text-decoration"
  | "hidden-column" | "hidden-row" | "paper-scale" | "hidden-sheet" | "protected-sheet"
  | "conditional-format" | "auto-filter" | "data-validation" | "image-omitted" | "image-segment"
  | "image-crop" | "image-transform" | "image-external" | "drawing-shape" | "chart" | "pivot"
  | "external-link" | "embedded-object";

/** Original workbook coordinates, independent of preview segmentation. Rows/columns are one-based. */
export interface ExcelImportDiagnosticLocation {
  sheet?: string;
  range?: string;
  cell?: string;
  row?: number;
  column?: number;
  /** OOXML part when a workbook feature cannot safely be attributed to a sheet. */
  part?: string;
}
export interface ExcelImportDiagnostic extends ExcelImportDiagnosticLocation {
  code: ExcelImportDiagnosticCode;
  severity: "warning";
  message: string;
}
export interface ExcelImportDiagnostics {
  /** Bounded detail window (200); use summary counts for all feature occurrences. */
  diagnostics?: readonly ExcelImportDiagnostic[];
  diagnosticSummary?: DiagnosticSummary<ExcelImportDiagnostic>;
}

export interface ExcelImportResult extends ExcelImportDiagnostics {
  template: ReportTemplate;
  warnings: string[];
  sheets: ExcelImportedSheet[];
}

export interface ResolvedImportOptions {
  layout: "wide" | "a3" | "a4";
  landscape: boolean;
  maxRowsPerPage: number;
  limits: Required<ExcelImportLimits>;
}

const DEFAULT_LIMITS: Required<ExcelImportLimits> = {
  maxFileBytes: 20 * 1024 * 1024,
  maxUncompressedBytes: 64 * 1024 * 1024,
  maxCells: 250_000,
  maxRows: 100_000,
  maxColumns: 2_048,
  maxSheets: 32
};

const HARD_LIMITS: Required<ExcelImportLimits> = {
  ...DEFAULT_LIMITS, maxCells: 1_000_000, maxRows: 1_048_576, maxColumns: 16_384
};

/** Custom budgets cannot disable hard safety ceilings. */
export function resolveImportOptions(options: ExcelImportOptions): ResolvedImportOptions {
  const layout = options.layout ?? "wide";
  if (!["wide", "a3", "a4"].includes(layout)) throw new Error("Excel 导入 layout 仅支持 wide、a3、a4");
  if (options.landscape !== undefined && typeof options.landscape !== "boolean") throw new Error("landscape 应为布尔值");
  const maxRowsPerPage = options.maxRowsPerPage ?? 80;
  if (!Number.isInteger(maxRowsPerPage) || maxRowsPerPage < 1 || maxRowsPerPage > 200) {
    throw new Error("maxRowsPerPage 应为 1 到 200 的整数");
  }
  const limits = { ...DEFAULT_LIMITS };
  for (const name of Object.keys(DEFAULT_LIMITS) as Array<keyof ExcelImportLimits>) {
    const value = options.limits?.[name];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 1 || value > HARD_LIMITS[name]) {
      throw new Error(`${name} 应为 1 到 ${HARD_LIMITS[name]} 的整数`);
    }
    limits[name] = value;
  }
  return { layout, landscape: options.landscape ?? true, maxRowsPerPage, limits };
}

/** Legacy messages remain deduplicated; structured counts describe every source occurrence. */
export class ImportWarnings {
  private readonly messages = new Set<string>();
  private readonly collector = createDiagnosticCollector<ExcelImportDiagnostic>(DEFAULT_DIAGNOSTIC_LIMIT);
  private overflow = false;
  add(message: string, code: ExcelImportDiagnosticCode, location: ExcelImportDiagnosticLocation = {}): void {
    if (this.messages.size < 200) this.messages.add(message);
    else if (!this.messages.has(message)) this.overflow = true;
    this.collector.push({ code, severity: "warning", message, ...location });
  }
  result(): string[] {
    return [...this.messages, ...(this.overflow ? ["其余导入告警已合并；请缩小范围进一步检查"] : [])];
  }
  structured(): Required<ExcelImportDiagnostics> {
    const diagnosticSummary = this.collector.snapshot();
    return { diagnostics: diagnosticSummary.entries, diagnosticSummary };
  }
  /** Preserve exact preflight counts without accumulating diagnostics across session selections. */
  fork(): ImportWarnings {
    const result = new ImportWarnings();
    for (const message of this.messages) result.messages.add(message);
    result.overflow = this.overflow;
    result.collector.merge(this.collector.snapshot());
    return result;
  }
}
