import { onScopeDispose, type Ref } from "vue";
import type { RenderPlan } from "@agile-team/mach-report";
import type { ReportInteractionOptions } from "../tools";

interface FrozenHost { root: Ref<HTMLElement | null>; viewport: Ref<HTMLElement | null>; plan: Ref<RenderPlan | null>; zoom: Ref<number>; options(): ReportInteractionOptions }

/** Translate only mounted preview cells; plans and export DOM never receive frozen-pane styles. */
export function useFrozenPanes(host: FrozenHost) {
  let frame = 0;
  let applied = false;
  function refresh(): void {
    const viewport = host.viewport.value;
    const root = host.root.value;
    const plan = host.plan.value;
    if (!viewport || !root || !plan) return;
    const options = host.options();
    const count = Math.max(0, Math.min(20, Math.floor(options.frozenColumns ?? 0)));
    if (!options.freezeHeaders && count === 0 && !applied) return;
    const scale = host.zoom.value || 1;
    const bounds = viewport.getBoundingClientRect();
    root.querySelectorAll<HTMLElement>("[data-mr-component-index]").forEach((element) => {
      const holder = element.closest<HTMLElement>("[data-page]");
      const pageIndex = Number(holder?.dataset.page) - 1;
      const component = plan.pages[pageIndex]?.components[Number(element.dataset.mrComponentIndex)];
      if (!component?.grid || !holder) return;
      element.style.transform = ""; element.style.zIndex = "";
      const box = element.getBoundingClientRect();
      const pageBottom = holder.getBoundingClientRect().bottom;
      const dx = Math.max(0, (bounds.left - box.left) / scale);
      const dy = options.freezeHeaders ? Math.max(0, Math.min((bounds.top - box.top) / scale, (pageBottom - box.bottom) / scale)) : 0;
      if (dx > 0 && count > 0) element.style.zIndex = "1";
      if (component.table?.role === "header" && dy > 0) { element.style.transform = `translateY(${dy}px)`; element.style.zIndex = "5"; }
      element.querySelectorAll<HTMLElement>(".mrp-cell-frozen").forEach((cell) => { cell.style.transform = ""; cell.style.zIndex = ""; cell.classList.remove("mrp-cell-frozen"); });
      const targets = Array.from({ length: count }, (_, column) => `td[data-mr-column-index="${column}"]`);
      if (!component.table && options.freezeHeaders) targets.push('td[data-mr-row-index="0"]');
      if (!targets.length) return;
      element.querySelectorAll<HTMLElement>(targets.join(",")).forEach((cell) => {
        const frozenColumn = Number(cell.dataset.mrColumnIndex) < count;
        const frozenRow = !component.table && Number(cell.dataset.mrRowIndex) === 0 && !!options.freezeHeaders;
        const x = frozenColumn ? dx : 0;
        const y = frozenRow ? dy : 0;
        cell.style.transform = x || y ? `translate(${x}px, ${y}px)` : "";
        cell.classList.toggle("mrp-cell-frozen", !!(x || y));
        cell.style.zIndex = x || y ? frozenRow ? "7" : "6" : "";
      });
    });
    applied = !!options.freezeHeaders || count > 0;
  }
  function schedule(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; refresh(); });
  }
  onScopeDispose(() => { if (frame) cancelAnimationFrame(frame); });
  return { refresh, schedule };
}
