import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, shallowRef, type EffectScope } from "vue";
import { renderPage, type RenderPlan } from "../../index";
import { clearHighlights, findSearchHighlight, highlightTextNodes } from "../composables/useHighlight";
import { useReportSearch } from "../composables/useReportSearch";
import { scanTextMatches } from "../composables/text-matches";

const scopes: EffectScope[] = [];
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.useRealTimers(); });

describe("case-insensitive source ranges", () => {
  it.each([
    ["İXA", "x", ["X"]],
    ["等级 İDATA", "data", ["DATA"]],
    ["İİ", "İ", ["İ", "İ"]],
    ["i\u0307 İ", "İ", ["i\u0307", "İ"]],
    ["İİİ", "\u0307i", ["İİ"]],
    ["İ😀等级İDATA", "😀等级", ["😀等级"]],
    ["İ𐐀𐐀", "𐐨", ["𐐀", "𐐀"]],
    ["数据 A\u0301 等级 a\u0301", "a\u0301", ["A\u0301", "a\u0301"]],
    ["ΟΣ 甲ΟΣ", "ΟΣ", ["ΟΣ", "ΟΣ"]],
    ["S316LE，0，钢钢", "钢", ["钢", "钢"]],
    ["Grade grade", "GRADE", ["Grade", "grade"]]
  ] as const)("marks the original characters in %s for %s", (text, query, expected) => {
    const root = document.createElement("div"); root.textContent = text;
    const count = highlightTextNodes(root, query);
    expect([...root.querySelectorAll("mark")].map(mark => mark.textContent)).toEqual(expected);
    expect(count).toBe(expected.length);
    expect(scanTextMatches(text, query.toLowerCase())).toBe(count);
    expect(root.textContent).toBe(text);
    clearHighlights(root);
    expect(root.textContent).toBe(text);
    expect(root.querySelectorAll("mark")).toHaveLength(0);
    expect(highlightTextNodes(root, query)).toBe(count);
  });

  it("does not produce a range for empty or absent queries", () => {
    const visit = vi.fn();
    expect(scanTextMatches("İDATA", "", visit)).toBe(0);
    expect(scanTextMatches("İDATA", "other", visit)).toBe(0);
    expect(visit).not.toHaveBeenCalled();
  });

  it("preserves markup boundaries and avoids changing existing marks, scripts and styles", () => {
    const root = document.createElement("div");
    root.innerHTML = '<span>İDATA</span><b> data</b><script>DATA</script><style>DATA</style><mark>DATA</mark>';
    const before = root.textContent;
    expect(highlightTextNodes(root, "data")).toBe(2);
    expect(root.querySelector("span mark")?.textContent).toBe("DATA");
    expect(root.querySelector("b mark")?.textContent).toBe("data");
    expect(root.querySelectorAll("mark mark")).toHaveLength(0);
    expect(root.textContent).toBe(before);
  });
});

describe("Unicode search navigation and DOM agreement", () => {
  it("counts and navigates every real mark across pages and repeated cell text", async () => {
    vi.useFakeTimers();
    const base = { kind: "rect" as const, leftMm: 0, topMm: 0, widthMm: 80, heightMm: 10 };
    const plan: RenderPlan = { schemaVersion: "unicode-search", pages: [
      { pageWidthMm: 100, pageHeightMm: 100, components: [{ ...base, grid: { cells: [[{ richParagraphs: [{ segments: [{ text: "İDATA" }, { text: " - İDATA" }] }] }]] } }] },
      { pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "text", leftMm: 0, topMm: 0, widthMm: 80, heightMm: 10, text: "İdata" }] }
    ] };
    const source = shallowRef<RenderPlan | null>(plan), scope = effectScope(); scopes.push(scope);
    const goto = vi.fn();
    const search = scope.run(() => useReportSearch({ plan: source, gotoPage: goto, debounceMs: 0, highlight: highlightTextNodes, clearHighlights }))!;
    const pages = plan.pages.map(page => renderPage(page, 96, {}, document));
    search.onInput("data"); await vi.runAllTimersAsync();
    const marked = pages.reduce((count, page) => count + highlightTextNodes(page, "data"), 0);
    expect(search.matchCount.value).toBe(marked); expect(marked).toBe(3);
    for (let index = 0; index < marked; index++) {
      const match = search.activeMatch.value!;
      expect(search.matchIndex.value).toBe(index);
      expect(findSearchHighlight(pages[match.pageIndex], match.target, match.occurrence)?.textContent?.toLowerCase()).toBe("data");
      search.onNav(1);
    }
    expect(search.matchIndex.value).toBe(0); search.onNav(-1);
    expect(search.matchIndex.value).toBe(2); expect(goto).toHaveBeenLastCalledWith(2);
    search.onInput("not found"); await vi.runAllTimersAsync();
    expect(search.matchCount.value).toBe(0); expect(search.activeMatch.value).toBeNull();
  });

  it("does not publish an expanded-case result after replacement, cancellation or disposal", async () => {
    vi.useFakeTimers();
    const make = (text: string): RenderPlan => ({ schemaVersion: "unicode-cancel", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "text", leftMm: 0, topMm: 0, widthMm: 80, heightMm: 10, text }] }] });
    const source = shallowRef<RenderPlan | null>(make("İDATA")), scope = effectScope(); scopes.push(scope);
    const goto = vi.fn();
    const search = scope.run(() => useReportSearch({ plan: source, gotoPage: goto, debounceMs: 200, highlight: highlightTextNodes, clearHighlights }))!;
    search.onInput("data"); source.value = make("other"); await vi.runAllTimersAsync();
    expect(search.matchCount.value).toBe(0); expect(goto).not.toHaveBeenCalled();
    search.onInput("other"); search.reset(); await vi.runAllTimersAsync(); expect(search.matchCount.value).toBe(0);
    search.onInput("other"); scope.stop(); await vi.runAllTimersAsync(); expect(goto).not.toHaveBeenCalled();
  });
});
