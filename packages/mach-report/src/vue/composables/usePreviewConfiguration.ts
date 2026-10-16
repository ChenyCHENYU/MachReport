import { computed, ref, type Ref } from "vue";
import { resolveConfig, useMachReportConfig, type MachReportDefaults, type MachReportMessages } from "../config";
import { REPORT_EXPORT_FORMATS, type ReportEmptyState, type ReportInteractionOptions, type ReportPreviewPreferences } from "../tools";
import { usePreviewTools } from "./usePreviewTools";

type PreviewConfigProps = Readonly<MachReportDefaults & { preset?: string; emptyState?: boolean | ReportEmptyState }>;
/** Centralize precedence and capability intersection; preferences never grant permissions. */
export function usePreviewConfiguration(props: PreviewConfigProps, wideReport: Readonly<Ref<boolean>>, warning: (message: string) => void) {
  const sessionInteraction = ref<ReportInteractionOptions>({});
  /** 配置解析：preset > 应用级 defaults；未配置时全部落到内置缺省 */
  const configRef = useMachReportConfig();
  const resolved = computed(() => resolveConfig(configRef.value, props.preset));
  const resolvedMessages = computed<MachReportMessages>(() => ({
    ...resolved.value.messages,
    ...props.messages
  }));
  /** 组件 props 拥有最高优先级（对齐 mach-table 配置中心的优先级约定） */
  const effectiveShowExport = computed(() => props.showExport ?? resolved.value.showExport);
  const effectiveShowPrint = computed(() => props.showPrint ?? resolved.value.showPrint);
  const effectiveShowPdfWindow = computed(() => props.showPdfWindow ?? resolved.value.showPdfWindow);
  const effectiveShowSettings = computed(() => props.showSettings ?? resolved.value.showSettings);
  const effectiveGuardChanges = computed(() => props.guardChanges ?? resolved.value.guardChanges);
  const effectiveOutput = computed(() => ({ ...resolved.value.output, ...props.output }));
  const toolbarOptions = computed(() => ({ ...resolved.value.toolbar, ...props.toolbar }));
  const effectiveInteraction = computed(() => ({ ...resolved.value.interaction, ...props.interaction, ...sessionInteraction.value }));
  const effectivePreferences = computed(() => props.preferences ?? resolved.value.preferences);
  const effectiveAssets = computed(() => props.assets ?? resolved.value.assets);
  const effectiveGapPx = computed(() => props.gapPx ?? (wideReport.value ? 0 : resolved.value.gapPx));
  const effectiveShowParams = computed(() => props.showParams ?? resolved.value.showParams);
  const availableEditable = computed(() => props.editable ?? resolved.value.editable);
  const availableExcelImport = computed(() => props.excelImport ?? resolved.value.excelImport);
  const availableTools = computed<ReportPreviewPreferences>(() => ({
    search: toolbarOptions.value.search !== false,
    thumbnails: toolbarOptions.value.thumbnails !== false,
    zoom: toolbarOptions.value.zoom !== false,
    ...Object.fromEntries(REPORT_EXPORT_FORMATS.map((format) => [format,
      effectiveShowExport.value && (toolbarOptions.value.exportFormats?.includes(format) ?? true)
    ])) as Record<typeof REPORT_EXPORT_FORMATS[number], boolean>,
    print: effectiveShowPrint.value,
    pdfWindow: effectiveShowPdfWindow.value,
    editing: !!availableEditable.value,
    import: !!availableExcelImport.value
  }));
  const tools = usePreviewTools(availableTools, computed(() => ({
    editing: toolbarOptions.value.editing,
    import: toolbarOptions.value.excelImport
  })), effectivePreferences, () => warning(resolvedMessages.value.preferencesError ?? "Preferences storage unavailable"));
  const toolState = tools.enabled;
  const visibleExportFormats = computed(() => REPORT_EXPORT_FORMATS.filter((format) => toolState.value[format]));
  const effectiveEditable = computed(() => toolState.value.editing ? availableEditable.value : false);
  const effectiveExcelImport = computed(() => toolState.value.import ? availableExcelImport.value : false);
  const persistedEditing = computed(() => typeof availableEditable.value === "object" && (typeof availableEditable.value.save === "function" || typeof availableEditable.value.saveBatch === "function"));
  const emptyStateContent = computed(() => typeof props.emptyState === "object" ? props.emptyState : {});

  return { resolved, resolvedMessages, effectiveShowExport, effectiveShowPrint, effectiveShowPdfWindow, effectiveShowSettings, effectiveGuardChanges, effectiveOutput, effectiveInteraction, effectiveAssets, effectiveGapPx, effectiveShowParams, availableTools, tools, toolState, visibleExportFormats, effectiveEditable, effectiveExcelImport, persistedEditing, emptyStateContent, sessionInteraction };
}
