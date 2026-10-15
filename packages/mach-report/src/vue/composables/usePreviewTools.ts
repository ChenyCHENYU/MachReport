import { computed, ref, type ComputedRef } from "vue";
import { REPORT_PREVIEW_TOOLS, type ReportPreviewPreferences, type ReportPreviewTool } from "../tools";

/** 偏好留在实例内；切换宿主能力后始终重新与能力上限取交集。 */
export function usePreviewTools(available: ComputedRef<ReportPreviewPreferences>, defaults: ComputedRef<Partial<ReportPreviewPreferences>>) {
  const preferences = ref<Partial<ReportPreviewPreferences>>({});
  const enabled = computed(() => Object.fromEntries(REPORT_PREVIEW_TOOLS.map((key) => [
    key, available.value[key] && (preferences.value[key] ?? defaults.value[key] ?? true)
  ])) as ReportPreviewPreferences);

  function setEnabled(key: ReportPreviewTool, value: boolean): void {
    if (available.value[key]) preferences.value = { ...preferences.value, [key]: value };
  }

  function reset(): void { preferences.value = {}; }
  return { enabled, setEnabled, reset };
}
