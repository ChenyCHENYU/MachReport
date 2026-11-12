import { computed, onScopeDispose, ref, watch, type ComputedRef } from "vue";
import { REPORT_PREVIEW_TOOLS, type ReportPreferencesOptions, type ReportPreviewPreferences, type ReportPreviewTool, type ReportStoredPreferences } from "../tools";
import { createPreferenceWrites } from "./preference-writes";

/** Tools and view preferences share one host scope and one serialized write queue. */
export function usePreviewTools(available: ComputedRef<ReportPreviewPreferences>, defaults: ComputedRef<Partial<ReportPreviewPreferences>>, persistence?: ComputedRef<ReportPreferencesOptions | undefined>, onError?: (cause: unknown) => void) {
  const preferences = ref<ReportStoredPreferences>({});
  let generation = 0;
  let changed = 0;
  const writes = createPreferenceWrites(onError);
  const enabled = computed(() => Object.fromEntries(REPORT_PREVIEW_TOOLS.map((key) => [
    key, available.value[key] && (preferences.value[key] ?? defaults.value[key] ?? true)
  ])) as ReportPreviewPreferences);

  function save(): void {
    const option = persistence?.value;
    if (!option) return;
    writes.save(option, { ...preferences.value }, generation);
  }
  function setEnabled(key: ReportPreviewTool, value: boolean): void {
    if (!available.value[key]) return;
    changed++;
    preferences.value = { ...preferences.value, [key]: value };
    save();
  }
  function getZoomMode(wide: boolean): "fit" | number | undefined {
    return preferences.value[wide ? "wideZoomMode" : "zoomMode"];
  }
  function setZoomMode(wide: boolean, value: "fit" | number): void {
    const key = wide ? "wideZoomMode" : "zoomMode";
    if (preferences.value[key] === value) return;
    changed++;
    preferences.value = { ...preferences.value, [key]: value };
    save();
  }
  function reset(): void { changed++; preferences.value = {}; save(); }
  if (persistence) watch(persistence, async (option) => {
    const current = ++generation;
    writes.scope(current);
    const revision = changed;
    preferences.value = {};
    if (!option) return;
    try {
      const value = await option.adapter.load(option.key);
      if (current !== generation || revision !== changed || !value || typeof value !== "object") return;
      const tools = Object.fromEntries(REPORT_PREVIEW_TOOLS.flatMap((key) => typeof value[key] === "boolean" ? [[key, value[key]]] : []));
      preferences.value = { ...tools, ...readViewPreferences(value) };
    } catch (cause) { writes.report(cause, current); }
  }, { immediate: true, flush: "sync" });
  onScopeDispose(() => { generation++; writes.dispose(); });
  return { enabled, setEnabled, reset, getZoomMode, setZoomMode };
}

function readViewPreferences(value: ReportStoredPreferences): ReportStoredPreferences {
  const view: ReportStoredPreferences = {};
  for (const key of ["zoomMode", "wideZoomMode"] as const) {
    const zoom = value[key];
    if (zoom === "fit" || typeof zoom === "number" && Number.isFinite(zoom) && zoom >= 30 && zoom <= 300) view[key] = zoom;
  }
  return view;
}
