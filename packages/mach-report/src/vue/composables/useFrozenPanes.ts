import { onScopeDispose, type Ref } from "vue";
import type { PlanComponent, RenderPlan } from "@agile-team/mach-report";
import type { ReportInteractionOptions } from "../tools";

interface FrozenHost { root: Ref<HTMLElement | null>; viewport: Ref<HTMLElement | null>; plan: Ref<RenderPlan | null>; zoom: Ref<number>; options(): ReportInteractionOptions }
interface CellStyle { cell: HTMLElement; transform: string; zIndex: string; fill: string }
interface FrozenComponent { element: HTMLElement; component: PlanComponent; transform: string; zIndex: string; cells: CellStyle[] }
interface FrozenPage { holder: HTMLElement; content: Element; index: number; components: FrozenComponent[] }
const PX_PER_MM = 96 / 25.4;

/** Preview-only decoration: preserve real cells, editing addresses and original output geometry. */
export function useFrozenPanes(host: FrozenHost) {
  let frame = 0, root: HTMLElement | null = null, plan: RenderPlan | null = null, key = "";
  let pages: FrozenPage[] = [];
  function restore(page: FrozenPage): void {
    page.holder.style.removeProperty("--mrp-freeze-page-x");
    for (const item of page.components) {
      item.element.style.transform = item.transform;
      item.element.style.zIndex = item.zIndex;
      item.element.style.removeProperty("--mrp-freeze-y");
      for (const saved of item.cells) {
        saved.cell.style.transform = saved.transform;
        saved.cell.style.zIndex = saved.zIndex;
        saved.cell.style.removeProperty("--mrp-frozen-fill");
        if (saved.fill) saved.cell.style.setProperty("--mrp-frozen-fill", saved.fill);
        saved.cell.classList.remove("mrp-cell-frozen");
      }
    }
  }
  function prepareComponent(element: HTMLElement, component: PlanComponent, count: number, headers: boolean): FrozenComponent {
    const item: FrozenComponent = { element, component, transform: element.style.transform, zIndex: element.style.zIndex, cells: [] };
    const header = headers && component.table?.role === "header";
    if (header) { element.style.transform = "translate3d(0,var(--mrp-freeze-y,0px),0)"; element.style.zIndex = "5"; }
    else if (count) element.style.zIndex = "1";
    element.querySelectorAll<HTMLElement>("td[data-mr-column-index]").forEach(cell => {
      const column = Number(cell.dataset.mrColumnIndex) < count;
      const row = headers && !component.table && Number(cell.dataset.mrRowIndex) === 0;
      if (!column && !row) return;
      item.cells.push({ cell, transform: cell.style.transform, zIndex: cell.style.zIndex, fill: cell.style.getPropertyValue("--mrp-frozen-fill") });
      const x = column ? `max(0px,calc(var(--mrp-freeze-page-x,0px) - ${component.leftMm * PX_PER_MM}px))` : "0px";
      cell.style.transform = `translate3d(${x},${row ? "var(--mrp-freeze-y,0px)" : "0px"},0)`;
      cell.style.zIndex = row || header ? "7" : "6";
      cell.style.setProperty("--mrp-frozen-fill", cell.style.backgroundColor || "transparent");
      cell.classList.add("mrp-cell-frozen");
    });
    return item;
  }
  function preparePage(holder: HTMLElement, current: RenderPlan, count: number, headers: boolean): FrozenPage | undefined {
    const index = Number(holder.dataset.page) - 1, page = current.pages[index], content = holder.firstElementChild;
    if (!page || !content) return;
    const components: FrozenComponent[] = [];
    holder.querySelectorAll<HTMLElement>("[data-mr-component-index]").forEach(element => {
      const component = page.components[Number(element.dataset.mrComponentIndex)];
      // Rotated grids have a different coordinate system; keep their declared geometry intact.
      if (component?.grid && !component.style?.rotateDeg) components.push(prepareComponent(element, component, count, headers));
    });
    return { holder, content, index, components };
  }
  function synchronize(currentRoot: HTMLElement, current: RenderPlan, count: number, headers: boolean): void {
    const nextKey = `${count}:${headers}`;
    if (root !== currentRoot || plan !== current || key !== nextKey) {
      pages.forEach(restore); pages = []; root = currentRoot; plan = current; key = nextKey;
    }
    if (!headers && !count) return;
    const previous = new Map(pages.map(page => [page.holder, page]));
    pages = [];
    currentRoot.querySelectorAll<HTMLElement>(".mrp-page-holder").forEach(holder => {
      let page = previous.get(holder); previous.delete(holder);
      if (page && page.content !== holder.firstElementChild) { restore(page); page = undefined; }
      page ??= preparePage(holder, current, count, headers);
      if (page) pages.push(page);
    });
    previous.forEach(restore);
  }
  function refresh(): void {
    const viewport = host.viewport.value, currentRoot = host.root.value, current = host.plan.value;
    if (!viewport || !currentRoot || !current) { pages.forEach(restore); pages = []; return; }
    const options = host.options(), count = Math.max(0, Math.min(20, Math.floor(options.frozenColumns ?? 0))) || 0;
    synchronize(currentRoot, current, count, !!options.freezeHeaders);
    if (!count && !options.freezeHeaders) return;
    const scale = host.zoom.value || 1, bounds = viewport.getBoundingClientRect();
    // Read once per mounted page, before writes. Scrolling never resets/re-measures each row/cell.
    const positions = pages.map(page => ({ page, bounds: page.holder.getBoundingClientRect() }));
    for (const position of positions) {
      const { page, bounds: pageBounds } = position;
      page.holder.style.setProperty("--mrp-freeze-page-x", `${Math.max(0, (bounds.left - pageBounds.left) / scale)}px`);
      if (!options.freezeHeaders) continue;
      for (const item of page.components) {
        if (item.component.table && item.component.table.role !== "header") continue;
        const top = item.component.topMm * PX_PER_MM, height = item.component.heightMm * PX_PER_MM;
        const end = current.pages[page.index]!.pageHeightMm * PX_PER_MM - top - height;
        const dy = Math.max(0, Math.min((bounds.top - pageBounds.top) / scale - top, end));
        item.element.style.setProperty("--mrp-freeze-y", `${dy}px`);
      }
    }
  }
  function schedule(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; refresh(); });
  }
  onScopeDispose(() => { if (frame) cancelAnimationFrame(frame); pages.forEach(restore); pages = []; });
  return { refresh, schedule };
}
