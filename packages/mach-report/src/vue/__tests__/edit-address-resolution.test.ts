// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { effectScope, shallowRef } from "vue";
import { createTableTemplate, createReportSource, createReportCellEditBatch, getReportEditSession, renderPage, type RenderPlan } from "../../index";
import { createEditAddressResolver } from "../composables/edit-recalculation";
import { useCellSelection } from "../composables/useCellSelection";

it("prefers the original mirror for navigation while marking every visible source mirror", async () => {
  const template = createTableTemplate({ layout: "wide", columns: [{ field: "id", header: "ID" }, { field: "qty", header: "Qty" }], listOptions: { rowKey: "id" } });
  const spec = { template, datasets: { detail: [{ id: "001", qty: 2 }] } }, source = createReportSource({ A: spec, B: spec });
  const initial = await source({ reportIds: ["A", "B"], params: {} });
  const address = { pageIndex: 0, componentIndex: 1, rowIndex: 0, columnIndex: 1 };
  const batch = createReportCellEditBatch(initial, [{ address, value: 5 }], "mirror");
  const next = (await getReportEditSession(initial)!.prepare(initial, batch)).commit();
  const locate = createEditAddressResolver(next);
  expect(locate(batch.edits[0]!)).toEqual(address);
  expect(locate.all(batch.edits[0]!).map((target) => target.pageIndex)).toEqual([0, 1]);
  const root = document.createElement("div"); document.body.append(root);
  next.pages.forEach((page, index) => { const holder = document.createElement("div"); holder.className = "mrp-page-holder"; holder.dataset.page = String(index + 1); holder.append(renderPage(page, 96, {}, document)); root.append(holder); });
  const scope = effectScope();
  try {
    const selection = scope.run(() => useCellSelection({ plan: shallowRef<RenderPlan | null>(next), root: shallowRef(root), enabled: () => true, busy: () => false, differences: () => batch.edits, gotoPage: vi.fn(), edit: vi.fn(), apply: vi.fn(), undo: vi.fn(), redo: vi.fn(), error: vi.fn() }))!;
    selection.refresh(); expect(root.querySelectorAll(".mrp-cell-modified")).toHaveLength(2);
  } finally { scope.stop(); root.remove(); }
});

describe("legacy physical address fallback", () => {
  it("keeps a manually supplied address when no source or logical table identity was declared", () => {
    const address = { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 };
    const plan: RenderPlan = { schemaVersion: "legacy", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 50, heightMm: 10, table: { id: "legacy", role: "body", rowIndex: 0, columnKeys: ["qty"] }, grid: { cells: [[{ value: 2, text: "2" }]] } }] }] };
    expect(createEditAddressResolver(plan)({ address, value: 2, text: "2", previousValue: 1, previousText: "1" })).toEqual(address);
  });
});
