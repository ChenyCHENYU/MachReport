/** 输出能力仍由宿主授权；工具偏好只决定当前预览实例的可见与启用状态。 */
export type ReportExportFormat = "html" | "pdf" | "xlsx" | "png" | "word";

export interface MachReportToolbarOptions {
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
  /** Screen-only frozen panes; exported geometry is unchanged. */
  freezeHeaders?: boolean;
  /** Leading identity columns, from 0 to 20. */
  frozenColumns?: number;
  /** Show workbook sheets / report sections when available. Default true. */
  navigation?: boolean;
}
export interface ReportSection { label: string; pageIndex: number }

export interface ReportPreferencesAdapter {
  load(key: string): Partial<ReportPreviewPreferences> | null | Promise<Partial<ReportPreviewPreferences> | null>;
  save(key: string, value: Readonly<Partial<ReportPreviewPreferences>>): void | Promise<void>;
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
    load: (key) => JSON.parse(storage.getItem(key) ?? "null") as Partial<ReportPreviewPreferences> | null,
    save: (key, value) => storage.setItem(key, JSON.stringify(value)),
    remove: (key) => storage.removeItem(key)
  };
}
