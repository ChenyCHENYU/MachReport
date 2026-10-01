import { computed, ref, shallowRef, type Ref } from "vue";
import type { RenderPlan } from "@agile-team/mach-report";

/**
 * 预览交互 composables 集合（本文件包含四件）：
 *
 * - useReportSearch：搜索（防抖索引 → 跳页导航 → 命中页高亮）
 * - useDebugPanel：调试面板（?mrp-debug=1；planKB 按 plan 引用缓存）
 * - useThumbs：缩略图侧栏（IntersectionObserver 懒渲染小画布）
 * - useLoadTiming：加载耗时计时（performance 不可用时降级为 0）
 */

export interface ReportSearchState {
  visible: Ref<boolean>;
  query: Ref<string>;
  matchIndex: Ref<number>;
  matchCount: Ref<number>;
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
  debounceMs?: number;
  highlight: (pageEl: HTMLElement, query: string) => number;
  clearHighlights: (pageEl: HTMLElement) => void;
}

function countOccurrences(text: string, q: string): number {
  let count = 0;
  let i = text.toLowerCase().indexOf(q);
  while (i >= 0) {
    count++;
    i = text.toLowerCase().indexOf(q, i + q.length);
  }
  return count;
}

export function useReportSearch(options: ReportSearchOptions): ReportSearchState {
  const { plan, gotoPage, highlight, clearHighlights } = options;
  const debounceMs = options.debounceMs ?? 200;
  // 输入防抖：避免逐键触发 O(全计划) 扫描与页面跳转抖动；
  // matchIndex 循环导航（‹/›）；高亮由页面挂载方调用 apply/clear
  // （虚拟化窗口外的页随窗口重建自然清理）

  const visible = ref(false);
  const query = ref("");          // 生效查询（防抖后）
  const rawInput = ref("");       // 原始输入
  const matchIndex = ref(0);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** 扁平命中表：每项为一次命中所在页索引 */
  const matches = computed<number[]>(() => {
    const q = query.value.trim().toLowerCase();
    const p = plan.value;
    if (!q || !p) return [];
    const out: number[] = [];
    p.pages.forEach((page, pageIndex) => {
      for (const comp of page.components) {
        if (comp.grid) {
          for (const row of comp.grid.cells ?? []) {
            for (const cell of row ?? []) {
              if (typeof cell?.text === "string") {
                for (let k = 0; k < countOccurrences(cell.text, q); k++) out.push(pageIndex);
              }
            }
          }
        } else if (comp.kind === "text" && typeof comp.text === "string") {
          for (let k = 0; k < countOccurrences(comp.text, q); k++) out.push(pageIndex);
        }
      }
    });
    return out;
  });
  const matchCount = computed(() => matches.value.length);

  function onInput(input: string): void {
    rawInput.value = input;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (input.trim() === "") {
      // 清空立即生效（不等防抖）
      debounceTimer = null;
      query.value = "";
      matchIndex.value = 0;
      return;
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      query.value = rawInput.value;
      matchIndex.value = 0;
      // 定位到首个命中页（无命中不动）
      const first = matches.value[0];
      if (first != null) gotoPage(first + 1);
    }, debounceMs);
  }

  function onNav(dir: 1 | -1): void {
    const total = matches.value.length;
    if (total === 0) return;
    matchIndex.value = (matchIndex.value + dir + total) % total;
    gotoPage(matches.value[matchIndex.value]! + 1);
  }

  function toggle(): void {
    visible.value = !visible.value;
  }

  function apply(pageEl: HTMLElement): void {
    const q = query.value.trim();
    if (q) highlight(pageEl, q);
  }

  function clear(pageEl: HTMLElement): void {
    clearHighlights(pageEl);
  }

  function reset(): void {
    rawInput.value = "";
    query.value = "";
    matchIndex.value = 0;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  return {
    visible,
    query,
    matchIndex,
    matchCount,
    toggle,
    onInput,
    onNav,
    apply,
    clear,
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
 * 缩略图侧栏：懒渲染小画布（IntersectionObserver + 低 dpr）。
 * 无 2D 环境（SSR/测试）保留占位框，不抛错。
 */
export function useThumbs(plan: Ref<RenderPlan | null>, opts: {
  thumbsRoot: Ref<HTMLElement | null>;
  visible: Ref<boolean>;
  renderThumbCanvas: (pageIndex: number) => HTMLCanvasElement | null;
}) {
  const { thumbsRoot, visible, renderThumbCanvas } = opts;
  let observer: IntersectionObserver | null = null;

  function renderInto(box: HTMLElement, pageIndex: number): void {
    if (!plan.value || box.childElementCount > 0) return;
    const canvas = renderThumbCanvas(pageIndex);
    if (!canvas) return;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    box.appendChild(canvas);
  }

  const schedule = (): void => {
    if (!visible.value || !plan.value || !thumbsRoot.value) return;
    if (typeof IntersectionObserver === "undefined") return;
    observer?.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const box = entry.target as HTMLElement;
          renderInto(box, Number(box.dataset.thumb ?? 1) - 1);
          observer?.unobserve(box);
        }
      },
      { root: thumbsRoot.value, rootMargin: "200px" }
    );
    thumbsRoot.value.querySelectorAll<HTMLElement>("[data-thumb]").forEach((el) => {
      observer!.observe(el);
    });
  };

  const destroy = (): void => {
    observer?.disconnect();
    observer = null;
  };

  return { schedule, destroy };
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
