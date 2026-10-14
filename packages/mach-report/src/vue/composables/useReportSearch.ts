import { computed, onScopeDispose, ref, shallowRef, unref, watch, type Ref } from "vue";
import { createPageWindowIndex } from "../../render/page-window-index";
import type { PlanComponent, RenderPlan } from "@agile-team/mach-report";

/**
 * 预览交互 composables 集合（本文件包含四件）：
 *
 * - useReportSearch：可取消的分片搜索 → 压缩命中计数 → 跳页高亮
 * - useDebugPanel：调试面板（?mrp-debug=1；planKB 按 plan 引用缓存）
 * - useThumbs：缩略图侧栏（虚拟窗口 + 每帧至多两个小画布）
 * - useLoadTiming：加载耗时计时（performance 不可用时降级为 0）
 */

export interface ReportSearchState {
  visible: Ref<boolean>;
  query: Ref<string>;
  matchIndex: Ref<number>;
  matchCount: Ref<number>;
  /** 当前页内命中序号，用于宽表将远右列的搜索结果滚动到可见位置。 */
  activeMatch: Ref<{ pageIndex: number; occurrence: number } | null>;
  /** 分片搜索期间不阻塞预览滚动，输入/换单据会取消旧搜索。 */
  searching: Ref<boolean>;
  toggle(): void;
  onInput(query: string): void;
  onNav(dir: 1 | -1): void;
  /** 页面元素高亮（查询为空时为 no-op） */
  apply(pageEl: HTMLElement): void;
  clear(pageEl: HTMLElement): void;
  /** 换单据/清空时的整体复位 */
  reset(): void;
}

export interface ReportSearchOptions {
  plan: Ref<RenderPlan | null>;
  gotoPage(page: number): void;
  debounceMs?: number | Ref<number>;
  highlight: (pageEl: HTMLElement, query: string) => number;
  clearHighlights: (pageEl: HTMLElement) => void;
}

function countOccurrences(text: string, q: string): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) count++;
  return count;
}

/** 与 DOM 实际文本节点一致，包含折行、富文本和单元格子组件。 */
function* componentTexts(components: PlanComponent[]): Generator<string> {
  const stack = [...components].reverse();
  while (stack.length > 0) {
    const comp = stack.pop()!;
    if (comp.grid) {
      for (const row of comp.grid.cells ?? []) {
        for (const cell of row ?? []) {
          yield cell?.text ?? "";
          if (cell?.children) {
            for (let i = cell.children.length - 1; i >= 0; i--) stack.push(cell.children[i]!);
          }
        }
      }
    } else if (comp.kind === "text") {
      if (comp.richParagraphs?.length) {
        for (const paragraph of comp.richParagraphs) {
          for (const segment of paragraph.segments ?? []) {
            yield (segment.kind === "field" ? segment.field : segment.text) ?? "";
          }
        }
      } else if (comp.lines?.length) {
        yield* comp.lines;
      } else {
        yield comp.text ?? "";
      }
    }
    // 非文本组件也计入分片工作量。
    yield "";
  }
}

function* pageTexts(plan: RenderPlan): Generator<{ text: string; pageIndex: number }> {
  for (let pageIndex = 0; pageIndex < plan.pages.length; pageIndex++) {
    for (const text of componentTexts(plan.pages[pageIndex]!.components)) yield { text, pageIndex };
    // 空页也计入工作量，避免稀疏计划在 generator.next() 内遍历所有页。
    yield { text: "", pageIndex };
  }
}

export function useReportSearch(options: ReportSearchOptions): ReportSearchState {
  const { plan, gotoPage, highlight, clearHighlights } = options;
  const visible = ref(false);
  const query = ref("");
  const matchIndex = ref(0);
  const matchCount = ref(0);
  const searching = ref(false);
  // 每个命中页只保存一次累计数量；百万次重复文本命中也不创建百万个页号。
  let matches: { pageIndex: number; cumulative: number }[] = [];
  const activeMatch = computed(() => {
    if (matchCount.value === 0) return null;
    const target = matchIndex.value;
    let lo = 0;
    let hi = matches.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (matches[mid]!.cumulative <= target) lo = mid + 1;
      else hi = mid;
    }
    const match = matches[lo];
    return match ? { pageIndex: match.pageIndex, occurrence: target - (matches[lo - 1]?.cumulative ?? 0) } : null;
  });
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  function cancel(): void {
    generation++;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (scanTimer) clearTimeout(scanTimer);
    debounceTimer = scanTimer = null;
    searching.value = false;
  }

  function search(input: string): void {
    query.value = input;
    matchIndex.value = 0;
    matchCount.value = 0;
    matches = [];
    searching.value = false;
    const q = input.trim().toLowerCase();
    const current = plan.value;
    if (!q || !current) return;
    searching.value = true;
    const seq = generation;
    const texts = pageTexts(current);
    const nextMatches: typeof matches = [];
    let count = 0;
    function scan(): void {
      scanTimer = null;
      if (seq !== generation || current !== plan.value) return;
      const started = performance.now();
      let scanned = 0;
      // 时间预算保持4ms；短单元格允许一片多扫描，减少嵌套定时器钳制产生的空等。
      while (scanned < 5000 && performance.now() - started < 4) {
        const next = texts.next();
        if (next.done) {
          matches = nextMatches;
          matchCount.value = count;
          searching.value = false;
          if (matches[0]) gotoPage(matches[0].pageIndex + 1);
          return;
        }
        const occurrences = countOccurrences(next.value.text, q);
        if (occurrences > 0) {
          count += occurrences;
          const previous = nextMatches[nextMatches.length - 1];
          if (previous?.pageIndex === next.value.pageIndex) previous.cumulative = count;
          else nextMatches.push({ pageIndex: next.value.pageIndex, cumulative: count });
        }
        scanned++;
      }
      scanTimer = setTimeout(scan, 0);
    }
    scan();
  }

  function onInput(input: string): void {
    cancel();
    // 输入与清旧结果即时生效，防抖窗口也不得让旧计数/导航驱动新的查询。
    query.value = input;
    matchIndex.value = matchCount.value = 0;
    matches = [];
    if (!input.trim()) {
      search("");
      return;
    }
    searching.value = true;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      search(input);
    }, Math.max(0, unref(options.debounceMs) ?? 200));
  }

  function onNav(dir: 1 | -1): void {
    const total = matchCount.value;
    if (total === 0 || searching.value) return;
    matchIndex.value = (matchIndex.value + dir + total) % total;
    let lo = 0;
    let hi = matches.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (matches[mid]!.cumulative <= matchIndex.value) lo = mid + 1;
      else hi = mid;
    }
    gotoPage(matches[lo]!.pageIndex + 1);
  }

  function reset(): void {
    cancel();
    query.value = "";
    matchIndex.value = matchCount.value = 0;
    matches = [];
  }
  watch(plan, reset, { flush: "sync" });
  onScopeDispose(reset);

  return {
    visible, query, matchIndex, matchCount, activeMatch, searching,
    toggle: () => { visible.value = !visible.value; },
    onInput, onNav,
    apply: (pageEl) => { if (query.value.trim()) highlight(pageEl, query.value.trim()); },
    clear: (pageEl) => { clearHighlights(pageEl); },
    reset
  };
}

/**
 * 调试面板状态：?mrp-debug=1 或 debug prop。
 * planKB 按 plan 引用缓存（滚动/缩放不触发全量 JSON 序列化）。
 */
export function useDebugPanel(debug: Ref<boolean>, stats: {
  plan: Ref<RenderPlan | null>;
  pageCount: Ref<number>;
  windowRange: Ref<{ start: number; end: number }>;
  zoom: Ref<number>;
  loadMs: Ref<number>;
}) {
  const enabled = computed(() => {
    if (debug.value) return true;
    if (typeof location === "undefined") return false;
    try {
      return new URLSearchParams(location.search).get("mrp-debug") === "1";
    } catch {
      return false;
    }
  });
  /** 仅依赖 plan 引用：JSON 序列化一次并缓存 */
  const planKB = computed(() => {
    if (!enabled.value || !stats.plan.value) return 0;
    return Math.round(JSON.stringify(stats.plan.value).length / 1024);
  });
  const debugStats = computed(() => {
    if (!enabled.value || !stats.plan.value) return null;
    return {
      pages: stats.pageCount.value,
      window: `${stats.windowRange.value.start}-${stats.windowRange.value.end}`,
      zoom: `${Math.round(stats.zoom.value * 100)}%`,
      loadMs: `${stats.loadMs.value}ms`,
      planKB: planKB.value
    };
  });
  return { enabled, debugStats };
}

/**
 * 缩略图侧栏：虚拟化纸面和页码，并分帧渲染低 dpr 小画布。
 * 无 2D 环境（SSR/测试）保留占位框，不抛错。
 */
export function useThumbs(plan: Ref<RenderPlan | null>, opts: {
  thumbsRoot: Ref<HTMLElement | null>;
  visible: Ref<boolean>;
  renderThumbCanvas: (pageIndex: number) => HTMLCanvasElement | null;
}) {
  const { thumbsRoot, visible, renderThumbCanvas } = opts;
  const scrollTop = ref(0);
  const viewportHeight = ref(800);
  const heights = computed(() => (plan.value?.pages ?? []).map(
    (page) => Math.round((page.pageHeightMm / page.pageWidthMm) * 116)
  ));
  // 116px 纸面 + 页码行 20px + 间距 8px，和模板中的固定高度完全一致。
  const geometry = computed(() => createPageWindowIndex(heights.value.map((height) => height + 20), 8));
  const windowRange = computed(() => geometry.value.window(viewportHeight.value, scrollTop.value, 1));
  const visibleThumbs = computed(() => {
    if (!visible.value) return [];
    const { start, end } = windowRange.value;
    return heights.value.slice(start, end + 1).map((height, i) => ({ index: start + i, height }));
  });
  let renderRaf = 0;
  let scrollRaf = 0;
  let destroyed = false;

  function refresh(): void {
    const root = thumbsRoot.value;
    if (!root) return;
    scrollTop.value = root.scrollTop;
    viewportHeight.value = root.clientHeight || 800;
  }

  function onScroll(): void {
    if (destroyed || scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      refresh();
    });
  }

  function schedule(): void {
    // 访问窗口使 watchEffect 跟踪滚动；离屏缩略图随虚拟节点删除释放 canvas。
    void visibleThumbs.value;
    if (renderRaf) cancelAnimationFrame(renderRaf);
    renderRaf = 0;
    if (destroyed || !visible.value || !plan.value || !thumbsRoot.value) return;
    refresh();
    const indexes = visibleThumbs.value;
    const current = plan.value;
    const root = thumbsRoot.value;
    let cursor = 0;
    function renderBatch(): void {
      renderRaf = 0;
      if (destroyed || !visible.value || plan.value !== current || thumbsRoot.value !== root) return;
      // 每帧至多两个小画布，避免打开侧栏时集中阻塞正文交互。
      for (let rendered = 0; cursor < indexes.length && rendered < 2; rendered++, cursor++) {
        const index = indexes[cursor]!.index;
        const box = root.querySelector<HTMLElement>(`[data-thumb="${index + 1}"]`);
        if (!box || box.childElementCount > 0) continue;
        const canvas = renderThumbCanvas(index);
        if (!canvas) continue;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        box.appendChild(canvas);
      }
      if (cursor < indexes.length) renderRaf = requestAnimationFrame(renderBatch);
    }
    renderRaf = requestAnimationFrame(renderBatch);
  }

  function destroy(): void {
    destroyed = true;
    if (renderRaf) cancelAnimationFrame(renderRaf);
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    renderRaf = scrollRaf = 0;
  }
  onScopeDispose(destroy);
  return { schedule, destroy, onScroll, windowRange, visibleThumbs };
}

/** 加载耗时计时（performance 不可用时为 0） */
export function useLoadTiming(): { loadMs: Ref<number>; start(): number; end(t0: number): void } {
  const loadMs = shallowRef(0);
  return {
    loadMs,
    start() {
      return typeof performance !== "undefined" ? performance.now() : 0;
    },
    end(t0: number) {
      loadMs.value = t0 ? Math.round(performance.now() - t0) : 0;
    }
  };
}
