import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, expect, it } from "vitest";
import { createTableTemplate, defineReportTemplate, type ListComponent, type ReportTemplateDocument } from "../../index";
import ColumnBatchEditor from "../ColumnBatchEditor.vue";
import { applyColumnBatch, type ColumnBatchPatch } from "../column-batch";
import { useTemplateEditor } from "../useTemplateEditor";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));
function fixture(layout: "wide" | "page" = "wide") {
  const doc = defineReportTemplate({ id: "batch", name: "批量", template: createTableTemplate({ layout, columns: [{ field: "a", header: "甲", widthMm: 25 }, { field: "b", header: "乙", widthMm: 35 }, { field: "c", header: "丙", widthMm: 45 }] }) });
  const list = doc.template.pages[0]!.components[0] as ListComponent;
  list.columns[0]!.style = { color: "#123456", italic: true };
  list.columns[0]!.format = { kind: "number", thousands: true, digits: 4 };
  list.columns[1]!.format = { kind: "number", digits: 2 };
  list.columns[2]!.hidden = true;
  return doc;
}
function listOf(doc: ReportTemplateDocument): ListComponent { return doc.template.pages[0]!.components[0] as ListComponent; }
it("changes only requested attributes and retains merged-header, hidden, natural number and paper declarations", () => {
  const doc = fixture();
  const page = doc.template.pages[0]!, list = listOf(doc), untouched = JSON.stringify(list.columns[2]);
  list.headerGrid = { cells: [[{ text: "组", colSpan: 2 }, { text: "丙" }]], colWidthsMm: list.columns.map(column => column.widthMm), rowHeightsMm: [8] };
  applyColumnBatch(doc, 0, 0, [0, 1, 1], { widthMm: 40, format: { kind: "number" }, bold: true, headerAlign: "right" }, "invalid");
  expect(list.columns[0]).toMatchObject({ field: "a", widthMm: 40, format: { kind: "number", thousands: true, digits: 4 }, style: { color: "#123456", italic: true, bold: true } });
  expect(list.columns[1]!.format).toEqual({ kind: "number", digits: 2 });
  expect(JSON.stringify(list.columns[2])).toBe(untouched);
  expect(list.headerGrid.colWidthsMm).toEqual([40, 40, 45]);
  expect(list.headerGrid.cells[0]![0]!.style?.align).toBe("right");
  expect(list.widthMm).toBe(125);
  expect(page.widthMm).toBe(list.leftMm + 125 + (page.marginRightMm ?? 0));
  const fixed = fixture("page"), fixedPageWidth = fixed.template.pages[0]!.widthMm, fixedListWidth = listOf(fixed).widthMm;
  applyColumnBatch(fixed, 0, 0, [0, 1], { widthMm: 40 }, "invalid");
  expect(fixed.template.pages[0]!.widthMm).toBe(fixedPageWidth);
  expect(listOf(fixed).widthMm).toBe(fixedListWidth);
});
it("rejects flow geometry and stale indices before modifying any selected column", () => {
  const doc = fixture();
  doc.template.pages[0]!.flow = { bands: [] };
  const before = JSON.stringify(doc);
  expect(() => applyColumnBatch(doc, 0, 0, [0, 1], { widthMm: 40, bold: true }, "invalid")).toThrow("invalid");
  expect(JSON.stringify(doc)).toBe(before);
  expect(() => applyColumnBatch(doc, 0, 0, [0, 99], { bold: true }, "invalid")).toThrow("invalid");
  expect(JSON.stringify(doc)).toBe(before);
  applyColumnBatch(doc, 0, 0, [0, 1], { format: null, italic: false }, "invalid");
  expect(listOf(doc).columns[0]!.format).toBeUndefined();
  expect(listOf(doc).columns[0]!.style).toEqual({ color: "#123456", italic: false });
});
it("stages mixed settings and applies many columns as one undoable transaction", async () => {
  const doc = fixture();
  let editor!: ReturnType<typeof useTemplateEditor>;
  const host = mount(defineComponent({ setup() { editor = useTemplateEditor({ modelValue: doc }, () => undefined); return () => null; } }));
  wrappers.push(host);
  const wrapper = mount(ColumnBatchEditor, { props: { list: listOf(editor.draft.value), indices: [0, 1], headerAlignments: ["center", "right", "center"], apply: (patch: ColumnBatchPatch) => editor.transaction(candidate => applyColumnBatch(candidate, 0, 0, [0, 1], patch, "invalid")) } });
  wrappers.push(wrapper);
  expect(wrapper.get('[data-mr-control="batch-width"]').attributes("placeholder")).toBe("混合值");
  expect(wrapper.get('[data-mr-control="batch-header-align"]').text()).toContain("保持原值 · 混合值");
  await wrapper.get('[data-mr-control="batch-width"]').setValue("40");
  await wrapper.get('[data-mr-control="batch-format"]').setValue("number");
  await wrapper.get('[data-mr-control="batch-digits"]').setValue("0");
  await wrapper.get('[data-mr-control="batch-bold"]').setValue("true");
  expect(editor.canUndo.value).toBe(false);
  const before = JSON.stringify(editor.draft.value);
  await wrapper.get('[data-mr-control="batch-apply"]').trigger("click");
  const after = JSON.stringify(editor.draft.value);
  expect(listOf(editor.draft.value).columns[0]).toMatchObject({ widthMm: 40, format: { kind: "number", thousands: true, digits: 0 }, style: { bold: true, color: "#123456" } });
  editor.undo(); expect(JSON.stringify(editor.draft.value)).toBe(before);
  expect(editor.canUndo.value).toBe(false);
  editor.redo(); expect(JSON.stringify(editor.draft.value)).toBe(after);
});
it("blocks invalid precision and readonly edits without creating history", async () => {
  let calls = 0;
  const wrapper = mount(ColumnBatchEditor, { props: { list: listOf(fixture()), indices: [0, 1], headerAlignments: [], flow: true, apply: () => { calls++; return true; } } });
  wrappers.push(wrapper);
  expect(wrapper.get('[data-mr-control="batch-width"]').attributes("disabled")).toBeDefined();
  await wrapper.get('[data-mr-control="batch-format"]').setValue("number");
  await wrapper.get('[data-mr-control="batch-digits"]').setValue("101");
  expect(wrapper.get('[data-mr-control="batch-apply"]').attributes("disabled")).toBeDefined();
  await wrapper.get('[data-mr-control="batch-apply"]').trigger("click");
  expect(calls).toBe(0);
  await wrapper.get('[data-mr-control="batch-digits"]').setValue("3");
  await wrapper.setProps({ disabled: true });
  await wrapper.get('[data-mr-control="batch-apply"]').trigger("click");
  expect(calls).toBe(0);
});
