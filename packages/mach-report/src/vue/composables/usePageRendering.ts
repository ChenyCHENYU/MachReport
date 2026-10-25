import { onScopeDispose, ref, watch, type Ref } from "vue";
import { createPageViewportRenderer, renderPage, resolveGridLayout, type PlanPage, type RenderPlan, type ReportCellAddress } from "@agile-team/mach-report";

interface PageRenderingHost {
  plan: Ref<RenderPlan | null>;
  root: Ref<HTMLElement | null>;
  viewport?: Ref<HTMLElement | null>;
  windowing?(): boolean;
  pages(): readonly { index: number }[];
  priority(): number;
  focusToken(): unknown;
  editorToken?(): unknown;
  query(): string;
  zoom(): number;
  loading(): string;
  clear(element: HTMLElement): void;
  highlight(element: HTMLElement): void;
  mounted(holder: HTMLElement): void;
  ready(): void;
  error(cause: unknown): void;
}
interface PageEntry { holder: HTMLElement; page: PlanPage; index: number }
interface MountedPage { page: PlanPage; element: HTMLElement; query: string; viewport?: ReturnType<typeof createPageViewportRenderer>; windowed: boolean }
const PX_PER_MM = 96 / 25.4;

/** Priority is synchronous for nextTick focus; all other new pages consume one animation frame. */
export function usePageRendering(host: PageRenderingHost) {
  const mounted = new WeakMap<HTMLElement, MountedPage>();
  const request = ref(0);
  let preferred: { plan: RenderPlan; index: number } | undefined;
  let generation = 0;
  let frame = 0;
  let disposed = false;
  let viewportFrame = 0;

  function cancel(): void {
    generation++;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }
  function active(entry: PageEntry, version: number, plan: RenderPlan, root: HTMLElement): boolean {
    return !disposed && version === generation && host.plan.value === plan && host.root.value === root
      && root.contains(entry.holder) && Number(entry.holder.dataset.page) === entry.index + 1;
  }
  function placeholder(entry: PageEntry): void {
    const { holder, page } = entry;
    mounted.delete(holder);
    holder.style.width = `${page.pageWidthMm * PX_PER_MM}px`;
    holder.style.height = `${page.pageHeightMm * PX_PER_MM}px`;
    holder.setAttribute("aria-busy", "true");
    const loading = holder.ownerDocument.createElement("div"); loading.className = "mrp-page-loading";
    const caption = holder.ownerDocument.createElement("span"); caption.textContent = host.loading();
    // The placeholder lives in report coordinates; keep its caption readable while fitting wide pages.
    caption.style.transform = `scale(${1 / Math.max(0.0001, host.zoom())})`;
    loading.append(caption); holder.replaceChildren(loading);
  }
  function cached(entry: PageEntry): boolean {
    const previous = mounted.get(entry.holder);
    if (!previous || previous.page !== entry.page || previous.element.parentElement !== entry.holder) return false;
    const editing = !!previous.element.querySelector(".mrp-cell-editor-host");
    if (previous.windowed !== shouldWindow(entry.page) && !editing) return false;
    updateViewport(entry.holder, previous);
    if (previous.query !== host.query() && !editing) {
      host.clear(previous.element); host.highlight(previous.element); previous.query = host.query();
    }
    return true;
  }
  function paint(entry: PageEntry, version: number, plan: RenderPlan, root: HTMLElement): void {
    if (!active(entry, version, plan, root)) return;
    try {
      const windowed = shouldWindow(entry.page);
      const viewport = windowed ? createPageViewportRenderer(entry.page, 96, {}, entry.holder.ownerDocument) : undefined;
      const element = viewport?.element ?? renderPage(entry.page, 96, {}, entry.holder.ownerDocument);
      host.highlight(element);
      if (!active(entry, version, plan, root)) return;
      entry.holder.replaceChildren(element);
      entry.holder.removeAttribute("aria-busy");
      const state = { page: entry.page, element, query: host.query(), viewport, windowed };
      mounted.set(entry.holder, state);
      updateViewport(entry.holder, state);
      host.mounted(entry.holder);
      host.ready();
    } catch (cause) {
      if (!active(entry, version, plan, root)) return;
      entry.holder.removeAttribute("aria-busy");
      const notice = entry.holder.ownerDocument.createElement("div");
      notice.className = "mrp-page-render-error"; notice.setAttribute("role", "alert");
      notice.textContent = cause instanceof Error ? cause.message : String(cause);
      entry.holder.replaceChildren(notice);
      host.error(cause);
    }
  }
  function schedule(entries: PageEntry[], version: number, plan: RenderPlan, root: HTMLElement): void {
    if (!entries.length) return;
    frame = requestAnimationFrame(() => {
      // A cancelled callback may already be queued; it must not clear a newer generation's frame.
      if (version !== generation || disposed) return;
      frame = 0;
      const entry = entries.shift();
      if (entry) paint(entry, version, plan, root);
      if (version === generation && host.plan.value === plan && host.root.value === root) schedule(entries, version, plan, root);
    });
  }
  function refresh(): void {
    cancel();
    const plan = host.plan.value, root = host.root.value;
    if (disposed || !plan || !root) { preferred = undefined; return; }
    const version = generation;
    const priority = preferred?.plan === plan ? preferred.index : host.priority();
    preferred = undefined;
    const pending: PageEntry[] = [];
    root.querySelectorAll<HTMLElement>(".mrp-page-holder").forEach((holder) => {
      const index = Number(holder.dataset.page) - 1;
      const page = plan.pages[index];
      if (!page) return;
      const entry = { holder, page, index };
      if (!cached(entry)) { placeholder(entry); pending.push(entry); }
    });
    const index = pending.findIndex((entry) => entry.index === priority);
    const immediate = index < 0 ? undefined : pending.splice(index, 1)[0];
    if (immediate) paint(immediate, version, plan, root);
    host.ready();
    schedule(pending, version, plan, root);
  }
  function prioritize(index: number): void {
    if (disposed || !host.plan.value) return;
    preferred = { plan: host.plan.value, index }; request.value++;
  }
  watch([host.plan, host.root, host.pages, host.priority, host.focusToken, () => host.editorToken?.(), host.query, host.zoom, host.loading, () => host.windowing?.(), request], refresh, { flush: "post", immediate: true });
  function shouldWindow(page: PlanPage): boolean {
    if (!host.viewport?.value?.clientWidth || host.windowing?.() === false || host.query().trim() || page.layout !== "wide") return false;
    return page.components.reduce((total, component) => total + (component.grid?.cells.reduce((count, row) => count + row.length, 0) ?? 0), 0) > 1000;
  }
  function updateViewport(holder: HTMLElement, state: MountedPage): void {
    const viewport = host.viewport?.value;
    if (!viewport || !state.viewport) return;
    const bounds = viewport.getBoundingClientRect(), pageBounds = holder.getBoundingClientRect(), scale = PX_PER_MM * host.zoom();
    const focused = holder.querySelector(".mrp-cell-editor-host")?.closest<HTMLElement>("td[data-mr-row-index]") ?? holder.ownerDocument.activeElement?.closest<HTMLElement>("td[data-mr-row-index]");
    const owner = focused?.closest<HTMLElement>("[data-mr-component-index]");
    const retained = focused && owner && holder.contains(focused) ? { componentIndex: Number(owner.dataset.mrComponentIndex), rowIndex: Number(focused.dataset.mrRowIndex), columnIndex: Number(focused.dataset.mrColumnIndex) } : undefined;
    if (state.viewport.update({ leftMm: (bounds.left - pageBounds.left) / scale, topMm: (bounds.top - pageBounds.top) / scale,
      widthMm: viewport.clientWidth / scale, heightMm: viewport.clientHeight / scale }, retained)) host.mounted(holder);
  }
  function refreshViewport(): void {
    if (disposed || viewportFrame) return;
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;
      if (disposed) return;
      host.root.value?.querySelectorAll<HTMLElement>(".mrp-page-holder").forEach(holder => {
        const state = mounted.get(holder); if (state) updateViewport(holder, state);
      });
    });
  }
  function reveal(address: ReportCellAddress): void {
    const viewport = host.viewport?.value, page = host.plan.value?.pages[address.pageIndex];
    const holder = host.root.value?.querySelector<HTMLElement>(`[data-page="${address.pageIndex + 1}"]`);
    const component = page?.components[address.componentIndex];
    if (!viewport || !holder || !component?.grid) return;
    const state = mounted.get(holder);
    if (!state?.viewport) return;
    const box = resolveGridLayout(component.grid, component.widthMm, component.heightMm).cells.find(cell => cell.ri === address.rowIndex && cell.ci === address.columnIndex);
    if (!box) return;
    const bounds = viewport.getBoundingClientRect(), origin = holder.getBoundingClientRect(), scale = PX_PER_MM * host.zoom();
    const left = origin.left + (component.leftMm + box.xMm) * scale, top = origin.top + (component.topMm + box.yMm) * scale;
    viewport.scrollLeft += scrollDelta(left, left + box.widthMm * scale, bounds.left, bounds.left + viewport.clientWidth);
    viewport.scrollTop += scrollDelta(top, top + box.heightMm * scale, bounds.top, bounds.top + viewport.clientHeight);
    updateViewport(holder, state);
  }
  function scrollDelta(start: number, end: number, low: number, high: number): number {
    if (start < low + 8) return start - low - 8;
    return end > high - 8 ? Math.min(start - low - 8, end - high + 8) : 0;
  }
  onScopeDispose(() => { disposed = true; preferred = undefined; cancel(); if (viewportFrame) cancelAnimationFrame(viewportFrame); });
  return { prioritize, cancel, refreshViewport, reveal };
}
