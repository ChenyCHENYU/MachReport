import { computed, inject, provide, type ComputedRef, type CSSProperties } from "vue";
import { MACH_REPORT_CONFIG_KEY } from "./injection-keys";
import type { XlsxRenderOptions } from "../xlsx/render-xlsx";
import type { ExcelImportOptions } from "../xlsx/import-types";
import type { ReportEditingOptions } from "./editing";
import type { MachReportToolbarOptions, ReportInteractionOptions, ReportPreferencesOptions } from "./tools";
import type { ReportBeforeDiscard, ReportOutputOptions } from "./guards";
import type { AssetRenderOptions } from "@agile-team/mach-report";

/**
 * 配置中心（对齐 mach-table 的 defineMachTableConfig 体验）：
 * - 应用级：app.use(machReportPlugin, { config: defineMachReportConfig({...}) })
 * - 路由级叠加：provideMachReportConfig(overlay)（响应式，就近覆盖）
 * - 优先级：组件 props > 路由级叠加 > preset > defaults（props 永远最高）
 */

/** 工具栏与状态文案（默认简体中文；出海场景覆写） */
export interface MachReportMessages {
  title: string;
  prevPage: string;
  nextPage: string;
  /** 页码显示模板，{cur}/{total} 占位 */
  pageInfo: string;
  fitWidth: string;
  exportHtml: string;
  exportPdf: string;
  exportExcel: string;
  exportImage: string;
  exportWord: string;
  /** 导出进行中提示，{format} 占位 */
  exporting: string;
  print: string;
  pdfWindow: string;
  loading: string;
  empty: string;
  /** @deprecated 未被组件消费，将在下个大版本移除（保留仅为类型兼容） */
  errorPrefix: string;
  retry: string;
  /** 可选新增文案，保留旧完整文案对象兼容。 */
  pdfFontUnavailable?: string;
  /** 搜索框占位文案 */
  searchPlaceholder: string;
  /** 搜索命中计数，{cur}/{total} 占位 */
  matchInfo: string;
  /** 上/下一个命中 */
  prevMatch: string;
  nextMatch: string;
  /** 缩略图侧栏开关 */
  thumbnails: string;
  /** 参数面板 */
  paramsTitle: string;
  query: string;
  reset: string;
  /** 必填缺失提示（{label} 占位） */
  paramRequired: string;
  paramInvalid?: string;
  paramPrompt?: string;
  paramPromptDescription?: string;
  paramSelectPlaceholder?: string;
  paramTextPlaceholder?: string;
  /** 可选搜索进度文案，旧完整 messages 对象无需新增字段。 */
  searching?: string;
  importExcel?: string;
  importing?: string;
  editCell?: string;
  editingHint?: string;
  saving?: string;
  editInvalidNumber?: string;
  editInvalidBoolean?: string;
  editConflict?: string;
  settings?: string;
  settingsDisplay?: string;
  settingsExport?: string;
  settingsData?: string;
  settingsUnavailable?: string;
  settingsReset?: string;
  settingsClose?: string;
  search?: string;
  closeSearch?: string;
  prevSearchMatch?: string;
  nextSearchMatch?: string;
  zoom?: string;
  settingsLocal?: string;
  editingLocal?: string;
  editingSaved?: string;
  importLocal?: string;
  emptyDescription?: string;
  undo?: string;
  redo?: string;
  restoreChanges?: string;
  changes?: string;
  changesCount?: string;
  changesEmpty?: string;
  changesBefore?: string;
  changesAfter?: string;
  editAtomicRequired?: string;
  clipboardLimit?: string;
  preferencesError?: string;
  freezeHeaders?: string;
  frozenColumns?: string;
  sections?: string;
  locateField?: string;
  locateFieldPlaceholder?: string;
  locateFieldMissing?: string;
  importSummary?: string;
  importPreserved?: string;
  importWarnings?: string;
  importReadOnly?: string;
  conflicts?: string;
  editReadOnly?: string;
  editMissing?: string;
  editDuplicate?: string;
  clipboardInvalid?: string;
  editSaved?: string;
  settingsPanes?: string;
  columnDirectory?: string;
  columnSearch?: string;
  columnNoMatches?: string;
  columnResults?: string;
  columnGroup?: string;
  discardTitle?: string;
  discardDescription?: string;
  discardKeep?: string;
  discardProceed?: string;
  taskQuery?: string;
  taskValidate?: string;
  taskLayout?: string;
  taskAssets?: string;
  taskEncode?: string;
  taskDownload?: string;
  taskPrint?: string;
  taskCancel?: string;
  taskCancelled?: string;
  diagnosticsTitle?: string;
  diagnosticsSearch?: string;
  diagnosticsMore?: string;
  diagnosticsLocate?: string;
  diagnosticsLocation?: string;
  diagnosticsStrict?: string;
  diagnosticsDetails?: string;
  diagnosticMissingImage?: string;
  diagnosticUnsupported?: string;
  diagnosticUnsupportedStyle?: string;
  diagnosticImageFormat?: string;
  diagnosticRichText?: string;
  diagnosticNested?: string;
  diagnosticImageAsync?: string;
  diagnosticImageDecode?: string;
  diagnosticAssetFailed?: string;
  diagnosticAssetBudget?: string;
}

export const DEFAULT_MESSAGES: MachReportMessages = {
  title: "报表预览",
  prevPage: "‹ 上一页",
  nextPage: "下一页 ›",
  pageInfo: "{cur} / {total}",
  fitWidth: "适宽",
  exportHtml: "导出 HTML",
  exportPdf: "导出 PDF",
  exportExcel: "导出 Excel",
  exportImage: "导出图片",
  exportWord: "导出 Word",
  exporting: "正在生成 {format}…",
  print: "打印",
  pdfWindow: "PDF 窗口",
  loading: "报表渲染中…",
  empty: "暂无预览数据",
  errorPrefix: "",
  retry: "重试",
  pdfFontUnavailable: "PDF 字体尚未就绪，请联系管理员检查字体配置；预览及其它导出仍可使用。",
  searchPlaceholder: "搜索报表内容",
  matchInfo: "{cur}/{total}",
  prevMatch: "‹",
  nextMatch: "›",
  thumbnails: "缩略图",
  paramsTitle: "查询条件",
  query: "查 询",
  reset: "重 置",
  paramRequired: "请填写{label}",
  paramInvalid: "{label}：{message}",
  paramPrompt: "请先完善查询条件",
  paramPromptDescription: "填写必填条件后点击查询，即可生成报表。",
  paramSelectPlaceholder: "请选择{label}",
  paramTextPlaceholder: "请输入{label}",
  searching: "搜索中…",
  importExcel: "导入 Excel 模板",
  importing: "正在导入 Excel…",
  editCell: "编辑单元格",
  editingHint: "双击单元格编辑 · Enter 确认 · Esc 取消",
  saving: "正在保存修改…",
  editInvalidNumber: "请输入有效数字；清空表示无值",
  editInvalidBoolean: "请输入 true / false、是 / 否或 1 / 0",
  editConflict: "该单元格已变化，请重新打开编辑",
  settings: "设置",
  settingsDisplay: "阅读工具",
  settingsExport: "导出与打印",
  settingsData: "数据操作",
  settingsUnavailable: "需由接入方配置启用",
  settingsReset: "恢复默认",
  settingsClose: "关闭设置",
  search: "内容搜索",
  closeSearch: "关闭搜索",
  prevSearchMatch: "上一个匹配",
  nextSearchMatch: "下一个匹配",
  zoom: "缩放工具",
  settingsLocal: "按需启用工具，仅作用于当前预览。",
  editingLocal: "修改为本地草稿；不会自动写入业务数据库。",
  editingSaved: "修改将通过接入方配置的保存回调提交。",
  importLocal: "导入仅生成本地预览，不自动替换业务数据。",
  emptyDescription: "当前查询没有明细，请调整查询条件后重试。",
  undo: "撤销", redo: "重做", restoreChanges: "恢复来源值", changes: "修改明细", changesCount: "{count} 处修改",
  changesEmpty: "尚无修改", changesBefore: "来源值", changesAfter: "当前值",
  editAtomicRequired: "批量保存需要接入方提供原子 saveBatch 回调；本次未写入任何单元格。",
  clipboardLimit: "单次最多粘贴 10000 个单元格，请分批处理。",
  preferencesError: "偏好存储不可用，设置仍在当前预览中生效。",
  freezeHeaders: "冻结表头", frozenColumns: "冻结前列", sections: "工作表与章节",
  locateField: "定位字段", locateFieldPlaceholder: "输入字段标识，Enter 定位", locateFieldMissing: "未找到该字段，请核对字段标识。",
  importSummary: "Excel 导入摘要", importPreserved: "已导入 {sheets} 个工作表，保留内容、合并和样式。",
  importWarnings: "兼容性提示", importReadOnly: "公式、日期及受保护单元格保持只读；公式不重算。",
  conflicts: "保存冲突",
  editReadOnly: "选区包含只读或无权限单元格，本次修改未应用。",
  editMissing: "选区超出报表范围或缺少业务来源，请重新选择。",
  editDuplicate: "选区包含同一业务字段的重复单元格，请缩小选区。",
  clipboardInvalid: "剪贴板内容无法识别，请使用矩形表格文本重新粘贴。",
  editSaved: "修改已通过保存回调确认",
  settingsPanes: "冻结窗格",
  columnDirectory: "字段目录", columnSearch: "搜索列名或字段", columnNoMatches: "未找到匹配字段", columnResults: "匹配字段", columnGroup: "明细区域",
  discardTitle: "保留当前修改？", discardDescription: "当前报表有尚未保存的输入或本地草稿，继续操作将替换这些内容。", discardKeep: "继续编辑", discardProceed: "放弃修改并继续",
  taskQuery: "正在获取数据…", taskValidate: "正在校验数据…", taskLayout: "正在生成版式…", taskAssets: "正在准备图片和字体…", taskEncode: "正在生成文件…", taskDownload: "正在准备下载…", taskPrint: "正在准备打印…", taskCancel: "取消任务", taskCancelled: "任务已取消，可重新操作。",
  diagnosticsSearch: "搜索提示、错误码或位置", diagnosticsMore: "共 {count} 条匹配，当前展示前 100 条；请搜索缩小范围。",
  diagnosticsTitle: "输出兼容性提示", diagnosticsLocate: "定位", diagnosticsLocation: "第 {page} 页 · 组件 {component}", diagnosticsStrict: "当前格式存在已知内容降级，请查看兼容性提示或选择其他输出格式。",
  diagnosticsDetails: "查看技术详情", diagnosticMissingImage: "图片或图表资源尚未准备完成，请重试或联系管理员。", diagnosticUnsupported: "当前输出格式会省略此内容，建议选择 PDF 或图片格式。", diagnosticUnsupportedStyle: "当前格式无法保留部分样式，请查看位置并选择适合的输出格式。", diagnosticImageFormat: "当前图片格式无法直接导出，请转换资源后重试。", diagnosticRichText: "文字内容会保留，部分字体与段落样式将简化。", diagnosticNested: "单元格中的嵌套内容会省略，单元格文字会保留。", diagnosticImageAsync: "图片需要完成加载后才能输出。", diagnosticImageDecode: "图片加载失败，请检查资源后重试。", diagnosticAssetFailed: "图表或图片生成失败，请重试或联系管理员。", diagnosticAssetBudget: "图片资源超出处理范围，请减少资源或缩小报表范围。"
};

/** 主题变量（组件外壳注入的 --mrp-* CSS 自定义属性） */
export interface MachReportTheme {
  shellBg: string;
  shellFg: string;
  toolbarBg: string;
  toolbarBorder: string;
  toolbarFg: string;
  btnFg: string;
  btnBorder: string;
  btnHoverBg: string;
  btnHoverFg: string;
  btnActiveBg: string;
}

export const DEFAULT_THEME: MachReportTheme = {
  shellBg: "#525659",
  shellFg: "#e8e8e8",
  toolbarBg: "#323639",
  toolbarBorder: "#22252a",
  toolbarFg: "#e8e8e8",
  btnFg: "#cfcfcf",
  btnBorder: "#4a4d52",
  btnHoverBg: "#414549",
  btnHoverFg: "#ffffff",
  btnActiveBg: "#2d5fb8"
};

/** 日志通道（默认 console；可注入 noop 静默或上报 collector） */
export type MachReportLogger = Pick<Console, "warn" | "info">;

/** 预览按需调优；默认已经启用正文/缩略图虚拟化及可取消的分片搜索。 */
export interface MachReportPreviewOptions {
  /** 视口前后额外保留的正文页数，默认 1，归一化到 0~10 的整数。 */
  overscanPages?: number;
  /** 搜索输入防抖毫秒，默认 200，归一化到 0~2000。 */
  searchDebounceMs?: number;
}

/** defaults 层可配置项（全部可选，均有内置缺省） */
export interface MachReportDefaults {
  showExport?: boolean;
  showPrint?: boolean;
  showPdfWindow?: boolean;
  /** 设置入口默认显示；可在其中按需启用阅读及输出工具。 */
  showSettings?: boolean;
  toolbar?: MachReportToolbarOptions;
  interaction?: ReportInteractionOptions;
  preferences?: ReportPreferencesOptions;
  /** Protect local input and drafts before replacing a report. Default true. */
  guardChanges?: boolean;
  beforeDiscard?: ReportBeforeDiscard;
  output?: ReportOutputOptions;
  /** Prepare optional image/chart/QR/barcode adapters once for preview and all outputs. */
  assets?: AssetRenderOptions;
  /** 参数面板显隐（有参数定义且未显式关闭时显示；缺省 true） */
  showParams?: boolean;
  /** 页间距 px */
  gapPx?: number;
  /** PDF 导出中文字体 URL */
  pdfFontUrl?: string;
  theme?: Partial<MachReportTheme>;
  messages?: Partial<MachReportMessages>;
  /** 校验告警等内部日志通道（默认 console；静默传 { warn: () => {}, info: () => {} }） */
  logger?: MachReportLogger;
  preview?: MachReportPreviewOptions;
  /** Excel 出口配置，按字段继承；不配置使用导出器默认值。 */
  xlsx?: XlsxRenderOptions;
  /** 默认关闭；true 为本地草稿，对象可提供权限、校验和保存回调。 */
  editable?: boolean | ReportEditingOptions;
  /** 默认关闭；启用后提供导入按钮。ExcelJS 仅在导入时加载。 */
  excelImport?: boolean | ExcelImportOptions;
}

export type MachReportPreset = MachReportDefaults;

export interface MachReportConfig {
  defaults: MachReportDefaults;
  presets: Record<string, MachReportPreset>;
  /** 默认启用的 preset 名 */
  defaultPreset?: string;
}

/** 应用配置输入：只声明需要的 defaults 或 presets，省略层由包内补齐。 */
export type MachReportConfigInput = Partial<MachReportConfig>;

/** 类型化配置声明，归一化为完整配置，便于直接传给插件或路由层。 */
export function defineMachReportConfig(config: MachReportConfigInput = {}): MachReportConfig {
  return { ...config, defaults: config.defaults ?? {}, presets: config.presets ?? {} };
}

/** 类型化 preset 声明 */
export function defineMachReportPreset(preset: MachReportPreset): MachReportPreset {
  return preset;
}

export type ResolvedConfig = Required<
  Pick<
    MachReportDefaults,
    "showExport" | "showPrint" | "showPdfWindow" | "showSettings" | "showParams" | "gapPx"
  >
> & {
  pdfFontUrl: string;
  theme: MachReportTheme;
  messages: MachReportMessages;
  logger: MachReportLogger;
  preview: Required<MachReportPreviewOptions>;
  xlsx: XlsxRenderOptions;
  editable: boolean | ReportEditingOptions;
  excelImport: boolean | ExcelImportOptions;
  toolbar: MachReportToolbarOptions;
  interaction: ReportInteractionOptions;
  preferences?: ReportPreferencesOptions;
  assets?: AssetRenderOptions;
  guardChanges: boolean;
  beforeDiscard?: ReportBeforeDiscard;
  output: ReportOutputOptions;
};

const FALLBACK_CONFIG: ResolvedConfig = {
  showExport: true,
  showPrint: true,
  showPdfWindow: true,
  showSettings: true,
  showParams: true,
  gapPx: 18,
  pdfFontUrl: "/simhei.ttf",
  theme: DEFAULT_THEME,
  messages: DEFAULT_MESSAGES,
  logger: console,
  preview: { overscanPages: 1, searchDebounceMs: 200 },
  xlsx: {},
  editable: false,
  excelImport: false,
  toolbar: {},
  interaction: {},
  guardChanges: true,
  output: {}
};

const SILENT_LOGGER: MachReportLogger = { warn: () => {}, info: () => {} };
export { SILENT_LOGGER };

/** 主题和文案按字段继承，避免局部覆盖要求业务重复整份配置。 */
function mergeDefaults(
  base: MachReportDefaults | undefined,
  overlay: MachReportDefaults | undefined
): MachReportDefaults {
  return {
    ...base,
    ...overlay,
    theme: { ...base?.theme, ...overlay?.theme },
    messages: { ...base?.messages, ...overlay?.messages },
    preview: { ...base?.preview, ...overlay?.preview },
    xlsx: { ...base?.xlsx, ...overlay?.xlsx },
    toolbar: { ...base?.toolbar, ...overlay?.toolbar },
    interaction: { ...base?.interaction, ...overlay?.interaction },
    output: { ...base?.output, ...overlay?.output }
  };
}

function resolveDisplayDefaults(merged: MachReportDefaults) {
  return {
    showExport: merged.showExport ?? FALLBACK_CONFIG.showExport,
    showPrint: merged.showPrint ?? FALLBACK_CONFIG.showPrint,
    showPdfWindow: merged.showPdfWindow ?? FALLBACK_CONFIG.showPdfWindow,
    showSettings: merged.showSettings ?? FALLBACK_CONFIG.showSettings,
    showParams: merged.showParams ?? FALLBACK_CONFIG.showParams,
    gapPx: merged.gapPx ?? FALLBACK_CONFIG.gapPx
  };
}

export function resolveConfig(
  config: MachReportConfig | null | undefined,
  presetName?: string
): ResolvedConfig {
  const preset = presetName ? config?.presets?.[presetName] : config?.defaultPreset
    ? config?.presets?.[config.defaultPreset]
    : undefined;
  const merged = mergeDefaults(config?.defaults, preset);
  return {
    ...resolveDisplayDefaults(merged),
    pdfFontUrl: merged.pdfFontUrl ?? FALLBACK_CONFIG.pdfFontUrl,
    theme: { ...DEFAULT_THEME, ...merged.theme },
    messages: { ...DEFAULT_MESSAGES, ...merged.messages },
    logger: merged.logger ?? FALLBACK_CONFIG.logger,
    preview: {
      overscanPages: boundedNumber(merged.preview?.overscanPages, 1, 10, true),
      searchDebounceMs: boundedNumber(merged.preview?.searchDebounceMs, 200, 2000)
    },
    xlsx: { ...merged.xlsx },
    editable: merged.editable ?? false,
    excelImport: merged.excelImport ?? false,
    toolbar: { ...merged.toolbar },
    interaction: { ...merged.interaction },
    preferences: merged.preferences,
    assets: merged.assets,
    guardChanges: merged.guardChanges ?? true,
    beforeDiscard: merged.beforeDiscard,
    output: { ...merged.output }
  };
}

function boundedNumber(value: number | undefined, fallback: number, max: number, integer = false): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  const bounded = Math.max(0, Math.min(max, value));
  return integer ? Math.floor(bounded) : bounded;
}

/** theme 对象 → CSS 自定义属性 style 对象（注入组件外壳） */
export function themeToCssVars(theme: Partial<MachReportTheme>): CSSProperties {
  const out: Record<string, string> = {};
  if (theme.shellBg != null) out["--mrp-shell-bg"] = theme.shellBg;
  if (theme.shellFg != null) out["--mrp-shell-fg"] = theme.shellFg;
  if (theme.toolbarBg != null) out["--mrp-toolbar-bg"] = theme.toolbarBg;
  if (theme.toolbarBorder != null) out["--mrp-toolbar-border"] = theme.toolbarBorder;
  if (theme.toolbarFg != null) out["--mrp-toolbar-fg"] = theme.toolbarFg;
  if (theme.btnFg != null) out["--mrp-btn-fg"] = theme.btnFg;
  if (theme.btnBorder != null) out["--mrp-btn-border"] = theme.btnBorder;
  if (theme.btnHoverBg != null) out["--mrp-btn-hover-bg"] = theme.btnHoverBg;
  if (theme.btnHoverFg != null) out["--mrp-btn-hover-fg"] = theme.btnHoverFg;
  if (theme.btnActiveBg != null) out["--mrp-btn-active-bg"] = theme.btnActiveBg;
  return out as CSSProperties;
}

type ConfigRef = ComputedRef<MachReportConfig | null>;

/**
 * 路由/布局级响应式叠加：就近提供配置层（如某路由关闭导出按钮）。
 * 本层 defaults 优先于上层 defaults/preset，本层 preset 再覆盖本层 defaults。
 * 同名 preset 与 messages/theme 均按字段继承；组件 props 仍拥有最高优先级。
 */
export function provideMachReportConfig(overlay: MachReportConfigInput | MachReportDefaults): void {
  const parent = inject<ConfigRef | null>(MACH_REPORT_CONFIG_KEY, null);
  const merged = computed<MachReportConfig | null>(() => {
    const parentConfig = parent?.value ?? null;
    const overlayConfig: MachReportConfig =
      "defaults" in overlay || "presets" in overlay || "defaultPreset" in overlay
        ? defineMachReportConfig(overlay as MachReportConfigInput)
        : { defaults: overlay as MachReportDefaults, presets: {} };
    if (!parentConfig) return overlayConfig;
    const presets = { ...parentConfig.presets, ...overlayConfig.presets };
    for (const name of Object.keys(presets)) {
      presets[name] = mergeDefaults(
        mergeDefaults(parentConfig.presets[name], overlayConfig.defaults),
        overlayConfig.presets[name]
      );
    }
    return {
      defaults: mergeDefaults(parentConfig.defaults, overlayConfig.defaults),
      presets,
      defaultPreset: overlayConfig.defaultPreset ?? parentConfig.defaultPreset
    };
  });
  provide(MACH_REPORT_CONFIG_KEY, merged);
}

/** 组件内部读取当前生效配置层（未提供时返回 null → 走内置缺省） */
export function useMachReportConfig(): ConfigRef {
  return inject<ConfigRef>(MACH_REPORT_CONFIG_KEY, computed(() => null));
}
