// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { effectScope, shallowRef } from "vue";
import { type GridCell, type RenderPlan, type ReportCellEdit } from "@agile-team/mach-report";
import ReportPreview from "../ReportPreview.vue";
import ReportEditBar from "../ReportEditBar.vue";
import { DEFAULT_MESSAGES } from "../config";
import type { MachReportController } from "../controller";
import { useCellEditingStatus } from "../composables/useCellEditingStatus";
import type { ReportEditingOptions } from "../editing";
import type { ReportCellSelection } from "../composables/useCellSelection";

const wrappers: VueWrapper[] = [];
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.replaceChildren(); });
const address = (columnIndex: number) => ({ pageIndex: 0, componentIndex: 1, rowIndex: 0, columnIndex });
function plan(): RenderPlan {
  return { schemaVersion: "review", pages: [{ pageWidthMm: 200, pageHeightMm: 100, components: [
    { kind: "rect", leftMm: 0, topMm: 0, widthMm: 200, heightMm: 10, table: { id: "orders", rowIndex: -1, role: "header", columnKeys: ["qty", "formula", "locked"] }, grid: { cells: [[{ text: "数量" }, { text: "计算结果" }, { text: "已保护" }]] } },
    { kind: "rect", leftMm: 0, topMm: 10, widthMm: 200, heightMm: 10, table: { id: "orders", rowIndex: 0, role: "body", columnKeys: ["qty", "formula", "locked"], source: { datasetId: "orders", rowKey: "R1" } }, grid: { cells: [[{ value: 1, text: "1" }, { value: 2, text: "2", formula: "A1*2" }, { value: 3, text: "3", editable: false }]] } }
  ] }] };
}

it("explains selected and attempted read-only cells through the normal preview entry points", async () => {
  const wrapper = mount(ReportPreview, { attachTo: document.body, props: { reportId: "review", fetcher: async () => plan(), editable: true, showExport: false, showPrint: false } });
  wrappers.push(wrapper);
  await vi.waitFor(() => expect(wrapper.findAll("td")).toHaveLength(6));
  const report = wrapper.vm as unknown as MachReportController;
  await report.focusCell!(address(0));
  expect(wrapper.find(".mrp-edit-hint").text()).toContain("可编辑");
  await report.focusCell!(address(1));
  expect(wrapper.find(".mrp-edit-hint").text()).toContain("公式结果");
  await wrapper.find('.mrp-body [data-mr-component-index="1"] td[data-mr-column-index="2"]').trigger("dblclick");
  await flushPromises();
  expect(wrapper.find(".mrp-edit-hint").text()).toContain("受保护");
  expect(wrapper.find(".mrp-cell-editor").exists()).toBe(false);
  await report.focusCell!({ ...address(0), componentIndex: 0 });
  expect(wrapper.find(".mrp-edit-hint").text()).toContain("结构单元格");
  await wrapper.setProps({ editable: { canEdit: () => false, readOnlyReason: () => "已封月，请联系业务负责人" } });
  await report.focusCell!(address(0));
  expect(wrapper.find(".mrp-edit-hint").text()).toContain("已封月");
  await wrapper.setProps({ refresh: { retainPrevious: true, pending: true } });
  expect(wrapper.find(".mrp-edit-hint").text()).toContain("报表处理中");
});

it("keeps a 5000-cell difference review bounded, searchable and navigable by its real identity", async () => {
  const differences: ReportCellEdit[] = Array.from({ length: 5000 }, (_, index) => ({ address: address(0), source: { datasetId: index % 2 ? "other" : "orders", rowKey: `R${index}`, field: "qty" }, table: { id: "orders", rowIndex: index, columnKey: "qty", role: "body" }, previousValue: 0, value: index + 1, previousText: "0", text: String(index + 1) }));
  const wrapper = mount(ReportEditBar, { attachTo: document.body, props: { differences, conflicts: [], plan: plan(), messages: DEFAULT_MESSAGES, saving: false, canUndo: true, canRedo: false, historyLimited: true } });
  wrappers.push(wrapper);
  expect(wrapper.findAll("li")).toHaveLength(0);
  await wrapper.find(".mrp-changes-trigger").trigger("click");
  await flushPromises();
  expect(wrapper.findAll("ol li")).toHaveLength(100);
  expect(wrapper.find("ol li").text()).toContain("数量 · R0");
  await wrapper.find(`button[aria-label="${DEFAULT_MESSAGES.nextPage}"]`).trigger("click");
  expect(wrapper.find("ol").attributes("start")).toBe("101");
  await wrapper.find("select").setValue("orders");
  await wrapper.find('input[type="search"]').setValue("R4998 qty");
  expect(wrapper.findAll("ol li")).toHaveLength(1);
  await wrapper.find("ol li button").trigger("click");
  expect(wrapper.emitted("locate")?.[0]?.[0]).toEqual(differences[4998]);
  await wrapper.find('input[type="search"]').setValue("missing");
  expect(wrapper.text()).toContain("没有匹配的修改");
  await wrapper.find(".mrp-changes").trigger("keydown", { key: "Escape" });
  await flushPromises();
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  expect(document.activeElement).toBe(wrapper.find(".mrp-changes-trigger").element);
  expect(wrapper.text()).toContain("来源差异仍完整保留");
  expect(differences).toHaveLength(5000);
});

it("keeps access feedback accurate for derived/complex cells, absent sources and failing host policies", () => {
  const current = shallowRef<RenderPlan | null>(plan());
  const options = shallowRef<boolean | ReportEditingOptions>(true);
  const selection = shallowRef<ReportCellSelection | null>({ anchor: address(0), focus: address(0) });
  const attempted = shallowRef(null);
  const scope = effectScope();
  const status = scope.run(() => useCellEditingStatus({ plan: current, options, selection, attempted, busy: () => false, messages: () => DEFAULT_MESSAGES }))!;
  function replaceCell(cell: GridCell): void {
    const next = plan();
    next.pages[0]!.components[1]!.grid!.cells[0]![0] = cell;
    current.value = next;
  }
  try {
    replaceCell({ value: 1, text: "1", derived: true });
    expect(status.value).toMatchObject({ editable: false, message: DEFAULT_MESSAGES.editCellDerived });
    replaceCell({ text: "rich", richParagraphs: [{ segments: [{ text: "rich" }] }] });
    expect(status.value).toMatchObject({ editable: false, message: DEFAULT_MESSAGES.editCellComplex });
    current.value = plan();
    options.value = { requireSource: true };
    const noSource = plan(); delete noSource.pages[0]!.components[1]!.table!.source;
    current.value = noSource;
    expect(status.value).toMatchObject({ editable: false, message: DEFAULT_MESSAGES.editMissing });
    const detached = plan(); detached.requiresRecalculation = true;
    current.value = detached;
    expect(status.value).toMatchObject({ editable: false, message: DEFAULT_MESSAGES.editRecalculationUnavailable });
    current.value = plan();
    options.value = { canEdit: () => { throw new Error("policy unavailable"); } };
    expect(status.value).toMatchObject({ editable: false, message: DEFAULT_MESSAGES.editCellPermission });
    options.value = false;
    expect(status.value).toBeNull();
    options.value = true; selection.value = null;
    expect(status.value).toBeNull();
  } finally { scope.stop(); }
});

it("keeps access feedback read-only during an asynchronous discard decision and restores it on rejection", async () => {
  let decide!: (value: boolean) => void;
  const beforeDiscard = vi.fn(() => new Promise<boolean>(resolve => { decide = resolve; }));
  const wrapper = mount(ReportPreview, { attachTo: document.body, props: { reportId: "review", fetcher: async () => plan(), editable: true, beforeDiscard, showExport: false } });
  wrappers.push(wrapper);
  await vi.waitFor(() => expect(wrapper.findAll("td")).toHaveLength(6));
  const report = wrapper.vm as unknown as MachReportController;
  await report.focusCell!(address(0));
  expect(await report.pasteSelection!("9")).toBe(true);
  const reload = report.reload();
  await vi.waitFor(() => expect(beforeDiscard).toHaveBeenCalledOnce());
  expect(wrapper.find(".mrp-edit-hint").text()).toContain("报表处理中");
  decide(false); await reload; await flushPromises();
  expect(wrapper.find(".mrp-edit-hint").text()).toContain("可编辑");
  expect(report.getDifferences!()).toMatchObject([{ value: 9 }]);
});
