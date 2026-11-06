import { ref, shallowRef, watch, type Ref } from "vue";
import type { ReportTemplateDocument } from "@agile-team/mach-report";
import type { PlanFetcher } from "../vue/adapters";

/** Keep each visited viewport, while hidden previews receive no obsolete layout work. */
export function useDesignerViews(document: Ref<ReportTemplateDocument>, mode: Ref<"design" | "preview">, fetcher: Readonly<Ref<PlanFetcher | undefined>>) {
  const canvasVisited = ref(false), previewVisited = ref(false);
  const visibleFetcher = shallowRef<PlanFetcher>();
  let identity = document.value.id;
  watch([mode, () => document.value.id, fetcher], () => {
    if (identity !== document.value.id) {
      identity = document.value.id;
      canvasVisited.value = false; previewVisited.value = false; visibleFetcher.value = undefined;
    }
    if (mode.value === "design") canvasVisited.value = true;
    else { previewVisited.value = true; visibleFetcher.value = fetcher.value; }
  }, { immediate: true, flush: "sync" });
  return { canvasVisited, previewVisited, visibleFetcher };
}
