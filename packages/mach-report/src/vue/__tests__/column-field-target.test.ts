import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { RenderPlan } from "../../index";
import ReportPreview from "../ReportPreview.vue";
import type { MachReportController } from "../controller";

describe("exact column focus targets", () => {
  it("locates the intended table even with an empty dataset and a merged header", async () => {
    const components = ["first", "second"].map((id, index) => ({ kind: "rect" as const, leftMm: 10, topMm: 10 + index * 20, widthMm: 100, heightMm: 10,
      table: { id, role: "header" as const, rowIndex: -1, columnKeys: ["heat", "weight"], source: { datasetId: "shared" } },
      grid: { colWidthsMm: [50, 50], rowHeightsMm: [10], cells: [[{ text: `${id} 合并标题`, colSpan: 2 }]] } }));
    const plan: RenderPlan = { schemaVersion: "test", pages: [{ pageWidthMm: 210, pageHeightMm: 100, components }] };
    const wrapper = mount(ReportPreview, { props: { reportId: "directory", fetcher: async () => plan, showExport: false, showPdfWindow: false }, attachTo: document.body });
    try {
      await flushPromises();
      const report = wrapper.vm as unknown as MachReportController;
      expect(await report.focusField!({ field: "weight", tableId: "second", datasetId: "shared" })).toBe(true);
      expect(report.getSelection!()?.focus).toEqual({ pageIndex: 0, componentIndex: 1, rowIndex: 0, columnIndex: 0 });
      expect(await report.focusField!({ field: "weight", tableId: "missing" })).toBe(false);
    } finally { wrapper.unmount(); }
  });
});
