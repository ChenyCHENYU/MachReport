import { onScopeDispose, ref, watch, type Ref } from "vue";
import { renderPage, type PlanPage, type RenderPlan } from "@agile-team/mach-report";

interface PageRenderingHost {
  plan: Ref<RenderPlan | null>;
  root: Ref<HTMLElement | null>;
  pages(): readonly { index: number }[];
  priority(): number;
  focusToken(): unknown;
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
interface MountedPage { page: PlanPage; element: HTMLElement; query: string }
const PX_PER_MM = 96 / 25.4;

/** Priority is synchronous for nextTick focus; all other new pages consume one animation frame. */
export function usePageRendering(host: PageRenderingHost) {
  const mounted = new WeakMap<HTMLElement, MountedPage>();
  const request = ref(0);
  let preferred: { plan: RenderPlan; index: number } | undefined;
  let generation = 0;
  let frame = 0;
  let disposed = false;

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
    if (previous.query !== host.query()) {
      host.clear(previous.element); host.highlight(previous.element); previous.query = host.query();
    }
    return true;
  }
  function paint(entry: PageEntry, version: number, plan: RenderPlan, root: HTMLElement): void {
    if (!active(entry, version, plan, root)) return;
    try {
      const element = renderPage(entry.page, 96, {}, entry.holder.ownerDocument);
      host.highlight(element);
      if (!active(entry, version, plan, root)) return;
      entry.holder.replaceChildren(element);
      entry.holder.removeAttribute("aria-busy");
      mounted.set(entry.holder, { page: entry.page, element, query: host.query() });
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
  watch([host.plan, host.root, host.pages, host.priority, host.focusToken, host.query, host.zoom, host.loading, request], refresh, { flush: "post", immediate: true });
  onScopeDispose(() => { disposed = true; preferred = undefined; cancel(); });
  return { prioritize, cancel };
}
