import { afterEach, expect, it, vi } from "vitest";
import { effectScope, shallowRef } from "vue";
import { renderPage, type RenderPlan } from "@agile-team/mach-report";
import { useFrozenPanes } from "../composables/useFrozenPanes";

const box = (left: number, top: number) => ({ left, top, right: left + 500, bottom: top + 500, x: left, y: top, width: 500, height: 500, toJSON: () => ({}) });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function fixture() {
  const plan: RenderPlan = { schemaVersion: "test", pages: [{ pageWidthMm: 300, pageHeightMm: 300, components: [
    { kind: "rect", leftMm: 10, topMm: 5, widthMm: 280, heightMm: 8, table: { id: "a", role: "header", rowIndex: -1, columnKeys: ["id", "qty"] }, style: { backgroundColor: "#e8eff8" }, grid: { colWidthsMm: [30, 250], cells: [[{ text: "编号" }, { text: "数量" }]] } },
    ...Array.from({ length: 50 }, (_, index) => ({ kind: "rect" as const, leftMm: 10, topMm: 13 + index * 5, widthMm: 280, heightMm: 5, table: { id: "a", role: "body" as const, rowIndex: index, columnKeys: ["id", "qty"] }, grid: { colWidthsMm: [30, 250], cells: [[{ text: `00${index}` }, { value: 0 }]] } }))
  ] }] };
  const original = JSON.stringify(plan), scope = effectScope();
  const root = document.createElement("div"), holder = document.createElement("div");
  holder.className = "mrp-page-holder"; holder.dataset.page = "1"; holder.append(renderPage(plan.pages[0]!, 96, {}, document)); root.append(holder); document.body.append(root);
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(box(0, 0));
  const pageBox = vi.spyOn(holder, "getBoundingClientRect").mockReturnValue(box(-200, -70));
  const options = { frozenColumns: 1, freezeHeaders: true };
  const planRef = shallowRef<RenderPlan | null>(plan);
  const frozen = scope.run(() => useFrozenPanes({ root: shallowRef(root), viewport: shallowRef(root), plan: planRef, zoom: shallowRef(1), options: () => options }))!;
  return { root, holder, pageBox, options, planRef, frozen, original, scope };
}
it("keeps original cells/identities and updates one page offset without per-row layout reads or cell resets", () => {
  const f = fixture(); f.frozen.refresh();
  expect(f.root.querySelectorAll(".mrp-cell-frozen")).toHaveLength(51);
  const first = f.root.querySelector<HTMLElement>('.mrp-cell-frozen[data-mr-column-index="0"]')!;
  expect(first.style.getPropertyValue("--mrp-frozen-fill")).toBe("#e8eff8");
  const observer = new MutationObserver(() => {}); observer.observe(f.root, { subtree: true, attributes: true });
  const reads = Array.from(f.root.querySelectorAll<HTMLElement>("[data-mr-component-index]"), node => vi.spyOn(node, "getBoundingClientRect"));
  f.pageBox.mockReturnValue(box(-400, -160)); f.frozen.refresh(); f.frozen.refresh();
  expect(reads.every(read => read.mock.calls.length === 0)).toBe(true);
  expect(observer.takeRecords().filter(record => record.target instanceof HTMLTableCellElement)).toEqual([]);
  expect(first.style.position).toBe("sticky");
  expect(first.style.left).toBe("0px");
  expect(first.style.transform).not.toContain("freeze-page-x");
  expect(f.holder.firstElementChild?.getAttribute("style")).toContain("overflow: clip");
  expect(f.root.querySelector(".mrp-cell-frozen")).toBe(first);
  expect(JSON.stringify(f.planRef.value)).toBe(f.original);
  observer.disconnect(); f.scope.stop();
});
it("restores all decorations on disable/disposal and refreshes newly painted pages", () => {
  const f = fixture(); f.frozen.refresh();
  const page = renderPage(f.planRef.value!.pages[0]!, 96, {}, document); f.holder.replaceChildren(page); f.frozen.refresh();
  expect(page.querySelectorAll(".mrp-cell-frozen")).toHaveLength(51);
  f.options.frozenColumns = 0; f.options.freezeHeaders = false; f.frozen.refresh();
  expect(f.root.querySelectorAll(".mrp-cell-frozen")).toHaveLength(0);
  expect(Array.from(page.querySelectorAll<HTMLElement>("td"), node => node.style.transform).every(value => value === "")).toBe(true);
  f.options.frozenColumns = 2; f.frozen.refresh(); expect(page.querySelectorAll(".mrp-cell-frozen")).toHaveLength(102);
  f.scope.stop(); expect(page.querySelectorAll(".mrp-cell-frozen")).toHaveLength(0);
});
it("clears stale decoration when the plan disappears and cancels queued work on scope disposal", () => {
  const f = fixture(); const cancel = vi.spyOn(globalThis, "cancelAnimationFrame"); f.frozen.refresh();
  f.planRef.value = null; f.frozen.refresh(); expect(f.root.querySelectorAll(".mrp-cell-frozen")).toHaveLength(0);
  f.frozen.schedule(); f.frozen.schedule(); f.scope.stop(); expect(cancel).toHaveBeenCalledTimes(1);
});
