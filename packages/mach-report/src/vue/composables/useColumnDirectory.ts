import { computed, getCurrentInstance, nextTick, ref, watch } from "vue";
import type { RenderPlan } from "../../schema/render-plan";
import { createColumnDirectory, searchColumnDirectory, type ReportColumnTarget } from "../column-directory";
import type { ReportSection } from "../tools";
import { usePopover } from "./usePopover";

/** Search every logical column; render a bounded list while keeping the input keyboard driven. */
export function useColumnDirectory(host: {
  plan(): RenderPlan | null | undefined;
  sections(): readonly ReportSection[];
  busy(): boolean;
  locate(target: ReportColumnTarget): void;
  locateField(field: string): void;
}) {
  const popup = usePopover();
  const field = ref("");
  const active = ref(0);
  const listId = `mrp-column-list-${getCurrentInstance()?.uid ?? 0}`;
  const directory = computed(() => createColumnDirectory(host.plan(), host.sections()));
  const matches = computed(() => searchColumnDirectory(directory.value, field.value));
  const candidates = computed(() => matches.value.slice(0, 100));
  const groups = computed(() => [...new Set(candidates.value.map((item) => item.group))].map((label) => ({ label, items: candidates.value.filter((item) => item.group === label) })));
  watch(field, () => { active.value = 0; });
  watch(host.busy, (busy) => { if (busy) popup.close(); });
  watch(directory, () => { active.value = 0; });
  function choose(target: ReportColumnTarget): void {
    if (host.busy()) return;
    host.locate(target); popup.close(true);
  }
  function submit(): void {
    if (host.busy()) return;
    const target = candidates.value[active.value];
    if (target) choose(target);
    else if (field.value.trim()) { host.locateField(field.value.trim()); popup.close(true); }
  }
  function clear(): void {
    field.value = "";
    popup.panel.value?.querySelector<HTMLInputElement>("input")?.focus();
  }
  function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229 || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === "Enter") { submit(); return; }
    if (!candidates.value.length) return;
    active.value = (active.value + (event.key === "ArrowDown" ? 1 : -1) + candidates.value.length) % candidates.value.length;
    void nextTick(() => popup.panel.value?.querySelector<HTMLElement>(`[id="${listId}-${active.value}"]`)?.scrollIntoView?.({ block: "nearest" }));
  }
  function candidateIndex(key: string): number { return candidates.value.findIndex((item) => item.key === key); }
  return { ...popup, field, active, listId, directory, matches, candidates, groups, choose, submit, clear, onSearchKeydown: onKeydown, candidateIndex };
}
