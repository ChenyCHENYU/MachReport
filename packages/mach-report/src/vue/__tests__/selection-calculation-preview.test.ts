// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { RenderPlan } from "@agile-team/mach-report";
import ReportPreview from "../ReportPreview.vue";
import type { MachReportController } from "../controller";
import type { ReportEditingOptions } from "../editing";

const wrappers: VueWrapper[] = [];
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); vi.restoreAllMocks(); document.body.replaceChildren(); });
function source(): RenderPlan {
  return { schemaVersion: "calculation-preview", pages: [{ pageWidthMm: 200, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 10, topMm: 10, widthMm: 120, heightMm: 25, grid: { colWidthsMm: [40, 40, 40], rowHeightsMm: [12, 13], cells: [
    [{ value: 0, text: "0", valueType: "number", editable: false }, { value: 2, text: "2", valueType: "number", editable: false }, { value: "001", text: "001", valueType: "text" }],
    [{ value: 4, text: "4", valueType: "number", editable: false }, { value: null, text: "" }, { value: 45600, text: "2024-11-03", numberFormat: "yyyy-mm-dd", editable: false }]
  ] } }] }] };
}
async function create(editable: boolean | ReportEditingOptions = false) {
  const original = source(), fetcher = vi.fn(async () => original);
  const wrapper = mount(ReportPreview, { props: { reportId: "local-analysis", fetcher, editable, toolbar: { editing: false }, showExport: false, showPdfWindow: false }, attachTo: document.body });
  wrappers.push(wrapper);
  await vi.waitFor(() => expect(wrapper.findAll("td")).toHaveLength(6));
  const controller = wrapper.vm as unknown as Required<Pick<MachReportController, "getPlan" | "getChanges" | "getSelection" | "pasteSelection">>;
  return { wrapper, controller, original, fetcher };
}
function tab(wrapper: VueWrapper, name: string) { return wrapper.findAll('[role="tab"]').find((item) => item.text() === name)!; }
async function settings(wrapper: VueWrapper) {
  const toggle = wrapper.find(".mrp-settings-toggle"); (toggle.element as HTMLElement).focus();
  await toggle.trigger("click"); await flushPromises();
}
async function advanced(wrapper: VueWrapper) { await tab(wrapper, "高级").trigger("click"); }
function checkbox(wrapper: VueWrapper) { return wrapper.find(".mrp-settings-feature input[type='checkbox']"); }
async function enable(wrapper: VueWrapper) {
  await settings(wrapper); await advanced(wrapper); await checkbox(wrapper).setValue(true);
  await wrapper.find(".mrp-settings-close").trigger("click");
}
async function selectAll(wrapper: VueWrapper) {
  await wrapper.find('td[data-mr-row-index="0"][data-mr-column-index="0"]').trigger("click");
  await wrapper.find('td[data-mr-row-index="1"][data-mr-column-index="2"]').trigger("click", { shiftKey: true });
}
async function reopenCalculation(wrapper: VueWrapper) {
  const toggle = wrapper.find(".mrp-calculation-toggle"); (toggle.element as HTMLElement).focus();
  await toggle.trigger("click"); await flushPromises();
}

describe("optional analysis through the real ReportPreview", () => {
  it("defaults off and enables only from the advanced settings, preserving tab semantics and focus", async () => {
    const { wrapper } = await create();
    expect(wrapper.find(".mrp-calculation").exists()).toBe(false);
    expect(wrapper.find(".mrp-calculation-toggle").exists()).toBe(false);
    await settings(wrapper);
    const general = tab(wrapper, "常规"), advancedTab = tab(wrapper, "高级");
    expect(general.attributes("aria-selected")).toBe("true");
    expect(advancedTab.attributes("tabindex")).toBe("-1");
    await general.trigger("keydown", { key: "End" });
    expect(advancedTab.attributes("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(advancedTab.element);
    expect((checkbox(wrapper).element as HTMLInputElement).checked).toBe(false);
    expect(wrapper.find(".mrp-calculation").exists()).toBe(false);
    await checkbox(wrapper).setValue(true);
    expect(wrapper.find(".mrp-calculation").attributes("aria-label")).toBe("选区计算");
    expect(wrapper.find(".mrp-calculation-toggle").exists()).toBe(true);
    const footer = wrapper.find(".mrp-settings-panel footer button"); (footer.element as HTMLElement).focus();
    const tabKey = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    footer.element.dispatchEvent(tabKey);
    expect(tabKey.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(wrapper.find(".mrp-settings-close").element);
    await wrapper.find(".mrp-settings-close").trigger("click");
    expect(document.activeElement).toBe(wrapper.find(".mrp-settings-toggle").element);
    await reopenCalculation(wrapper);
    expect(tab(wrapper, "高级").attributes("aria-selected")).toBe("true");
    await wrapper.find(".mrp-settings-panel").trigger("keydown", { key: "Escape" });
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.find(".mrp-calculation-toggle").element);
  });

  it("calculates readonly Shift selections with zero, excludes text/date/blank and diagnoses a controlled expression", async () => {
    const { wrapper, controller, original, fetcher } = await create();
    const before = structuredClone(original);
    await enable(wrapper); await selectAll(wrapper);
    expect(wrapper.findAll(".mrp-cell-selected")).toHaveLength(6);
    expect(controller.getSelection()?.anchor.rowIndex).toBe(0);
    await reopenCalculation(wrapper);
    expect(wrapper.find("output").exists()).toBe(false);
    await wrapper.find(".mrp-calculation-run").trigger("click"); await flushPromises();
    expect(wrapper.find(".mrp-calculation-result output").text()).toBe("6.00");
    expect(wrapper.find(".mrp-calculation-result").text()).toContain("参与数值 3");
    expect(wrapper.find(".mrp-calculation-result").text()).toContain("排除单元格 3");
    await wrapper.find(".mrp-calculation select").setValue("expression");
    await wrapper.find('.mrp-calculation input[type="text"]').setValue("SUM / COUNT");
    await wrapper.find(".mrp-calculation-run").trigger("click"); await flushPromises();
    expect(wrapper.find("output").text()).toBe("2.00");
    await wrapper.find('.mrp-calculation input[type="text"]').setValue("SUM / (COUNT - 3)");
    await wrapper.find(".mrp-calculation-run").trigger("click"); await flushPromises();
    expect(wrapper.find(".mrp-calculation [role='alert']").text()).toContain("除数不能为 0");
    expect(controller.getChanges()).toEqual([]);
    expect(controller.getPlan()).toEqual(before);
    expect(original).toEqual(before);
    expect(wrapper.emitted("cell-edit")).toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("never activates field resolvers, validation or persistence from readonly F2, Enter, undo/redo or paste", async () => {
    const fields = vi.fn(() => ({ type: "number" as const })), validate = vi.fn(), save = vi.fn(), saveBatch = vi.fn();
    const { wrapper, controller, original, fetcher } = await create({ fields, validate, save, saveBatch });
    await enable(wrapper); await selectAll(wrapper);
    const viewport = wrapper.find(".mrp-body");
    await viewport.trigger("keydown", { key: "F2" });
    await viewport.trigger("keydown", { key: "Enter" });
    await viewport.trigger("keydown", { key: "z", ctrlKey: true });
    await viewport.trigger("keydown", { key: "z", metaKey: true, shiftKey: true });
    await viewport.trigger("keydown", { key: "y", ctrlKey: true });
    await wrapper.find("td").trigger("dblclick");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { types: ["text/plain"], getData: () => "999\t100" } });
    viewport.element.dispatchEvent(paste); await flushPromises();
    expect(paste.defaultPrevented).toBe(false);
    expect(await controller.pasteSelection("888")).toBe(false);
    expect(wrapper.find(".mrp-cell-editor").exists()).toBe(false);
    expect(wrapper.find(".mrp-edit-hint").exists()).toBe(false);
    for (const callback of [fields, validate, save, saveBatch]) expect(callback).not.toHaveBeenCalled();
    expect(controller.getPlan()).toEqual(original);
    expect(controller.getChanges()).toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("clears results on disable/re-enable and on a new Shift selection without running another calculation", async () => {
    const { wrapper } = await create();
    await enable(wrapper); await selectAll(wrapper); await reopenCalculation(wrapper);
    await wrapper.find(".mrp-calculation-run").trigger("click"); await flushPromises();
    expect(wrapper.find("output").text()).toBe("6.00");
    await checkbox(wrapper).setValue(false); await flushPromises();
    expect(wrapper.find(".mrp-calculation-toggle").exists()).toBe(false);
    expect(wrapper.find(".mrp-calculation").exists()).toBe(false);
    await checkbox(wrapper).setValue(true); await flushPromises();
    expect(wrapper.find("output").exists()).toBe(false);
    await wrapper.find(".mrp-calculation-run").trigger("click"); await flushPromises();
    expect(wrapper.find("output").text()).toBe("6.00");
    await wrapper.find(".mrp-settings-close").trigger("click");
    await wrapper.find('td[data-mr-row-index="0"][data-mr-column-index="1"]').trigger("click");
    await wrapper.find(".mrp-body").trigger("keydown", { key: "ArrowLeft", shiftKey: true }); await flushPromises();
    await reopenCalculation(wrapper);
    expect(wrapper.find("output").exists()).toBe(false);
    await wrapper.find(".mrp-calculation-run").trigger("click"); await flushPromises();
    expect(wrapper.find("output").text()).toBe("2.00");
  });
});
