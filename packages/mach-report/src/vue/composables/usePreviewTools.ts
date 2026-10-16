import { computed, onScopeDispose, ref, watch, type ComputedRef } from "vue";
import { REPORT_PREVIEW_TOOLS, type ReportPreferencesOptions, type ReportPreviewPreferences, type ReportPreviewTool } from "../tools";

/** 偏好留在实例内；切换宿主能力后始终重新与能力上限取交集。 */
export function usePreviewTools(available: ComputedRef<ReportPreviewPreferences>, defaults: ComputedRef<Partial<ReportPreviewPreferences>>, persistence?: ComputedRef<ReportPreferencesOptions | undefined>, onError?: (cause: unknown) => void) {
  const preferences = ref<Partial<ReportPreviewPreferences>>({});
  let generation = 0;
  let changed = 0;
  let writes = Promise.resolve();
  const enabled = computed(() => Object.fromEntries(REPORT_PREVIEW_TOOLS.map((key) => [
    key, available.value[key] && (preferences.value[key] ?? defaults.value[key] ?? true)
  ])) as ReportPreviewPreferences);

  function setEnabled(key: ReportPreviewTool, value: boolean): void {
    if (!available.value[key]) return;
    changed++;
    preferences.value = { ...preferences.value, [key]: value };
    save();
  }

  function save(): void {
    const option = persistence?.value;
    if (!option) return;
    const snapshot = { ...preferences.value };
    writes = writes.then(() => option.adapter.save(option.key, snapshot)).catch((cause) => { onError?.(cause); });
  }
  function reset(): void { changed++; preferences.value = {}; save(); }
  if (persistence) watch(persistence, async (option) => {
    const current = ++generation;
    const revision = changed;
    preferences.value = {};
    if (!option) return;
    try {
      const value = await option.adapter.load(option.key);
      if (current !== generation || revision !== changed || !value || typeof value !== "object") return;
      preferences.value = Object.fromEntries(REPORT_PREVIEW_TOOLS.flatMap((key) => typeof value[key] === "boolean" ? [[key, value[key]]] : []));
    } catch (cause) { if (current === generation) onError?.(cause); }
  }, { immediate: true });
  onScopeDispose(() => { generation++; });
  return { enabled, setEnabled, reset };
}
