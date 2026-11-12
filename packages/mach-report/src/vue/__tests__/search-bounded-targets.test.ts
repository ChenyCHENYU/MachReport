// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, shallowRef, type EffectScope } from "vue";
import type { RenderPlan } from "../../schema/render-plan";
import { validateRenderPlan } from "../../schema/validate";
import * as texts from "../composables/plan-texts";
import { useReportSearch } from "../composables/useReportSearch";
import { createSearchTargetIndex } from "../composables/search-target-index";

const scopes: EffectScope[] = [];
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.restoreAllMocks(); vi.useRealTimers(); });
function use(source: RenderPlan) {
  const plan = shallowRef<RenderPlan | null>(source), scope = effectScope(); scopes.push(scope);
  const goto = vi.fn();
  const search = scope.run(() => useReportSearch({ plan, gotoPage: goto, debounceMs: 0, highlight: () => 0, clearHighlights() {} }))!;
  return { plan, search, goto, scope };
}
function dense(rows = 5000): RenderPlan {
  return { schemaVersion: "1.0.0-mach", pages: [{ layout: "wide", pageWidthMm: 100, pageHeightMm: 4500, components: Array.from({ length: rows }, (_, index) => ({
    kind: "text", leftMm: 0, topMm: index * 0.8, widthMm: 100, heightMm: 0.8, text: "needle"
  })) }] };
}

describe("bounded search target lookup", () => {
  it("reuses scan targets for the final unique hit in a valid 180000-cell page", async () => {
    vi.useFakeTimers();
    const rows = 900, columns = 200;
    const source: RenderPlan = { schemaVersion: "1.0.0-mach", pages: [{ layout: "wide", pageWidthMm: 3000, pageHeightMm: 4500,
      components: Array.from({ length: rows }, (_, row) => ({ kind: "rect", leftMm: 0, topMm: row * 5, widthMm: 3000, heightMm: 5,
        grid: { colWidthsMm: Array(columns).fill(15), rowHeightsMm: [5], cells: [Array.from({ length: columns }, (_, column) => ({ text: row === rows - 1 && column === columns - 1 ? "needle" : "same" }))] }
      }))
    }] };
    const validation = validateRenderPlan(source);
    expect(validation.ok, JSON.stringify(validation.errors)).toBe(true);
    const stream = vi.spyOn(texts, "pageTexts"), { search } = use(source);
    search.onInput("needle"); await vi.runAllTimersAsync();
    expect(search.matchCount.value).toBe(1);
    expect(search.activeMatch.value?.target).toEqual({ componentIndex: 899, rowIndex: 0, columnIndex: 199, occurrence: 0 });
    expect(stream).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 20; index++) { search.onNav(-1); expect(search.activeMatch.value?.target?.componentIndex).toBe(899); }
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("does not synchronously rescan an overflow page and cancels its pending navigation on replacement", async () => {
    vi.useFakeTimers();
    const { search, plan, goto } = use(dense());
    search.onInput("needle"); await vi.runAllTimersAsync();
    expect(search.matchCount.value).toBe(5000);
    goto.mockClear();
    search.matchIndex.value = 2500;
    expect(search.activeMatch.value).toBeNull();
    plan.value = dense(1);
    await vi.runAllTimersAsync();
    expect(search.matchCount.value).toBe(0); expect(search.activeMatch.value).toBeNull();
    expect(goto).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves dense overflow navigation exactly and keeps first/last navigation immediate", async () => {
    vi.useFakeTimers();
    const { search, scope } = use(dense());
    search.onInput("needle"); await vi.runAllTimersAsync();
    search.onNav(-1); expect(search.activeMatch.value?.target).toMatchObject({ componentIndex: 4999, occurrence: 0 });
    search.matchIndex.value = 2499; search.onNav(1);
    expect(search.activeMatch.value).toBeNull();
    await vi.runAllTimersAsync();
    expect(search.activeMatch.value?.target).toMatchObject({ componentIndex: 2500, occurrence: 0 });
    search.matchIndex.value = 0;
    expect(search.activeMatch.value?.target).toMatchObject({ componentIndex: 0, occurrence: 0 });
    search.matchIndex.value = 2500; scope.stop();
    await vi.runAllTimersAsync(); expect(vi.getTimerCount()).toBe(0);
  });

  it("retains at most 1024 intervals even for dense targets and compresses a million same-cell hits", () => {
    const index = createSearchTargetIndex();
    for (let componentIndex = 0; componentIndex < 50_000; componentIndex++) index.record(0, { componentIndex }, 2, componentIndex * 2);
    expect(index.size).toBe(1024);
    expect(index.find(0)?.target).toEqual({ componentIndex: 0, occurrence: 0 });
    expect(index.find(99_999)?.target).toEqual({ componentIndex: 49_999, occurrence: 1 });
    expect(index.find(50_000)).toBeUndefined();
    const repeated = createSearchTargetIndex();
    repeated.record(0, { componentIndex: 1, rowIndex: 2, columnIndex: 3 }, 500_000, 0);
    repeated.record(0, { componentIndex: 1, rowIndex: 2, columnIndex: 3 }, 500_000, 500_000);
    expect(repeated.size).toBe(1);
    expect(repeated.find(999_999)?.target).toEqual({ componentIndex: 1, rowIndex: 2, columnIndex: 3, occurrence: 999_999 });
    expect(repeated.find(-1)).toBeUndefined(); expect(repeated.find(1_000_000)).toBeUndefined();
  });

  it("resolves merged rich/child overflow targets and ignores superseded navigation and queries", async () => {
    vi.useFakeTimers();
    const source = dense(1213), components = source.pages[0]!.components;
    components[512] = { kind: "rect", leftMm: 0, topMm: 512, widthMm: 100, heightMm: 10, grid: { colWidthsMm: [25, 25, 25, 25], rowHeightsMm: [5, 5], cells: [
      [{ text: "ordinary", rowSpan: 2, colSpan: 2 }, { text: "ordinary" }, { text: "ordinary" }],
      [{ richParagraphs: [{ segments: [{ text: "needle" }, { text: "needle" }] }], children: [{ kind: "text", leftMm: 0, topMm: 0, widthMm: 20, heightMm: 4, text: "needle" }] }, { text: "ordinary" }]
    ] } };
    const validation = validateRenderPlan(source);
    expect(validation.ok, JSON.stringify(validation.errors)).toBe(true);
    const { search, goto } = use(source);
    search.onInput("needle"); await vi.runAllTimersAsync();
    expect(search.matchCount.value).toBe(1215);
    search.matchIndex.value = 513;
    expect(search.activeMatch.value).toBeNull();
    await vi.runAllTimersAsync();
    expect(search.activeMatch.value?.target).toEqual({ componentIndex: 512, rowIndex: 1, columnIndex: 2, occurrence: 1 });
    search.matchIndex.value = 512; search.matchIndex.value = 514;
    await vi.runAllTimersAsync();
    expect(search.activeMatch.value?.target).toEqual({ componentIndex: 512, rowIndex: 1, columnIndex: 2, occurrence: 2 });
    search.matchIndex.value = 513; goto.mockClear(); search.onInput("absent");
    await vi.runAllTimersAsync();
    expect(search.activeMatch.value).toBeNull(); expect(goto).not.toHaveBeenCalled();
  });
});
