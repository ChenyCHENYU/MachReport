/** 输出能力仍由宿主授权；工具偏好只决定当前预览实例的可见与启用状态。 */
export type ReportExportFormat = "html" | "pdf" | "xlsx" | "png" | "word";

export interface MachReportToolbarOptions {
  /** Reasons explain host restrictions without granting capabilities. */
  unavailableReasons?: Partial<Record<ReportPreviewTool, string>>;
  search?: boolean;
  thumbnails?: boolean;
  zoom?: boolean;
  /** 编辑能力由 editable 授权；此项仅设置初始交互偏好，默认 true（兼容旧行为）。 */
  editing?: boolean;
  /** 导入能力由 excelImport 授权；此项仅设置初始交互偏好，默认 true。 */
  excelImport?: boolean;
  /** 未传时显示全部已有出口；空数组表示不提供导出工具。 */
  exportFormats?: ReportExportFormat[];
}

/** 报表含表头但业务行为空时，由接入方明确声明；组件不推测业务数据。 */
export interface ReportEmptyState {
  title?: string;
  description?: string;
}

export const REPORT_EXPORT_FORMATS: readonly ReportExportFormat[] = ["html", "pdf", "xlsx", "png", "word"];
export const REPORT_PREVIEW_TOOLS = ["search", "thumbnails", "zoom", ...REPORT_EXPORT_FORMATS, "print", "pdfWindow", "editing", "import"] as const;
export type ReportPreviewTool = "search" | "thumbnails" | "zoom" | ReportExportFormat | "print" | "pdfWindow" | "editing" | "import";
export type ReportPreviewPreferences = Record<ReportPreviewTool, boolean>;

export interface ReportInteractionOptions {
  /** 只读选区计算，默认关闭；不写回业务值或执行导入的 Excel 公式。 */
  calculations?: boolean;
  /** Screen-only frozen panes; exported geometry is unchanged. */
  freezeHeaders?: boolean;
  /** Leading identity columns, from 0 to 20. */
  frozenColumns?: number;
  /** Show workbook sheets / report sections when available. Default true. */
  navigation?: boolean;
}
/** Explicit refresh policy. The key identifies template/layout revisions outside query parameters. */
export interface ReportRefreshOptions {
  retainPrevious?: boolean;
  key?: string;
  /** Host API request preceding the preview reload. Blocks edits and output without discarding drafts. */
  pending?: boolean;
  /** The host retained an earlier snapshot after its own query failed or was cancelled. */
  stale?: boolean;
  /** Retry the host HTTP query when it owns the stale snapshot. The host updates its own state. */
  retry?(): void | Promise<void>;
}
export interface ReportStoredPreferences extends Partial<ReportPreviewPreferences> {
  zoomMode?: "fit" | number;
  wideZoomMode?: "fit" | number;
}
export interface ReportSection { label: string; pageIndex: number }

export interface ReportPreferencesAdapter {
  load(key: string): ReportStoredPreferences | null | Promise<ReportStoredPreferences | null>;
  save(key: string, value: Readonly<ReportStoredPreferences>): void | Promise<void>;
  remove?(key: string): void | Promise<void>;
}
export interface ReportPreferencesOptions {
  /** Host-scoped key; do not share one key between unrelated users/tenants. */
  key: string;
  adapter: ReportPreferencesAdapter;
}

/** Optional browser convenience adapter. Access errors are handled by the preview. */
export function createReportStoragePreferences(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): ReportPreferencesAdapter {
  return {
    load: (key) => JSON.parse(storage.getItem(key) ?? "null") as ReportStoredPreferences | null,
    save: (key, value) => storage.setItem(key, JSON.stringify(value)),
    remove: (key) => storage.removeItem(key)
  };
}
