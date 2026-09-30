import { computed, inject, provide, type ComputedRef, type CSSProperties } from "vue";
import { MACH_REPORT_CONFIG_KEY } from "./injection-keys";

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
  print: string;
  pdfWindow: string;
  loading: string;
  empty: string;
  errorPrefix: string;
  retry: string;
}

export const DEFAULT_MESSAGES: MachReportMessages = {
  title: "报表预览",
  prevPage: "‹ 上一页",
  nextPage: "下一页 ›",
  pageInfo: "{cur} / {total}",
  fitWidth: "适宽",
  exportHtml: "导出 HTML",
  exportPdf: "导出 PDF",
  print: "打印",
  pdfWindow: "PDF 窗口",
  loading: "报表渲染中…",
  empty: "暂无预览数据",
  errorPrefix: "",
  retry: "重试"
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

/** defaults 层可配置项（全部可选，均有内置缺省） */
export interface MachReportDefaults {
  showExport?: boolean;
  showPrint?: boolean;
  showPdfWindow?: boolean;
  /** 页间距 px */
  gapPx?: number;
  /** PDF 导出中文字体 URL */
  pdfFontUrl?: string;
  theme?: Partial<MachReportTheme>;
  messages?: Partial<MachReportMessages>;
}

export type MachReportPreset = MachReportDefaults;

export interface MachReportConfig {
  defaults: MachReportDefaults;
  presets: Record<string, MachReportPreset>;
  /** 默认启用的 preset 名 */
  defaultPreset?: string;
}

/** 类型化配置声明（纯类型助手，便于独立 config 文件） */
export function defineMachReportConfig(config: MachReportConfig): MachReportConfig {
  return config;
}

/** 类型化 preset 声明 */
export function defineMachReportPreset(preset: MachReportPreset): MachReportPreset {
  return preset;
}

export type ResolvedConfig = Required<
  Pick<MachReportDefaults, "showExport" | "showPrint" | "showPdfWindow" | "gapPx">
> & { pdfFontUrl: string; theme: MachReportTheme; messages: MachReportMessages };

const FALLBACK_CONFIG: ResolvedConfig = {
  showExport: true,
  showPrint: true,
  showPdfWindow: true,
  gapPx: 18,
  pdfFontUrl: "/simhei.ttf",
  theme: DEFAULT_THEME,
  messages: DEFAULT_MESSAGES
};

export function resolveConfig(
  config: MachReportConfig | null | undefined,
  presetName?: string
): ResolvedConfig {
  const preset = presetName ? config?.presets?.[presetName] : config?.defaultPreset
    ? config?.presets?.[config.defaultPreset]
    : undefined;
  const merged: MachReportDefaults = { ...config?.defaults, ...preset };
  return {
    showExport: merged.showExport ?? FALLBACK_CONFIG.showExport,
    showPrint: merged.showPrint ?? FALLBACK_CONFIG.showPrint,
    showPdfWindow: merged.showPdfWindow ?? FALLBACK_CONFIG.showPdfWindow,
    gapPx: merged.gapPx ?? FALLBACK_CONFIG.gapPx,
    pdfFontUrl: merged.pdfFontUrl ?? FALLBACK_CONFIG.pdfFontUrl,
    theme: { ...DEFAULT_THEME, ...merged.theme },
    messages: { ...DEFAULT_MESSAGES, ...merged.messages }
  };
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
 * 与应用级 config 合并（本层 defaults/presets 优先）。
 */
export function provideMachReportConfig(overlay: MachReportConfig | MachReportDefaults): void {
  const parent = inject<ConfigRef | null>(MACH_REPORT_CONFIG_KEY, null);
  const merged = computed<MachReportConfig | null>(() => {
    const parentConfig = parent?.value ?? null;
    const overlayConfig: MachReportConfig =
      "defaults" in overlay && "presets" in overlay
        ? overlay
        : { defaults: overlay as MachReportDefaults, presets: {} };
    if (!parentConfig) return overlayConfig;
    return {
      defaults: { ...parentConfig.defaults, ...overlayConfig.defaults },
      presets: { ...parentConfig.presets, ...overlayConfig.presets },
      defaultPreset: overlayConfig.defaultPreset ?? parentConfig.defaultPreset
    };
  });
  provide(MACH_REPORT_CONFIG_KEY, merged);
}

/** 组件内部读取当前生效配置层（未提供时返回 null → 走内置缺省） */
export function useMachReportConfig(): ConfigRef {
  return inject<ConfigRef>(MACH_REPORT_CONFIG_KEY, computed(() => null));
}
