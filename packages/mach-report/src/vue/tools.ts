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
export type ReportPreviewTool = typeof REPORT_PREVIEW_TOOLS[number];
export type ReportPreviewPreferences = Record<ReportPreviewTool, boolean>;
