// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { computed, effectScope, ref } from "vue";
import type { RenderPlan, ReportCellFieldOptions } from "@agile-team/mach-report";
import ReportPreview from "../ReportPreview.vue";
import { useEditHistory } from "../composables/useEditHistory";
import { useCellEditing } from "../composables/useCellEditing";
import type { MachReportController } from "../controller";
import type { ReportEditingOptions } from "../editing";

const wrappers = new Set<VueWrapper>();
afterEach(() => { for (const wrapper of wrappers) wrapper.unmount(); wrappers.clear(); document.body.replaceChildren(); });
const columns = ["qty", "code", "enabled", "status", "date", "protectedDate", "formula"];
function plan(): RenderPlan {
  return { schemaVersion: "typed-editors", pages: [{ pageWidthMm: 300, pageHeightMm: 100, components: [{
    kind: "rect", leftMm: 5, topMm: 5, widthMm: 280, heightMm: 12,
    table: { id: "orders", rowIndex: 0, role: "body", columnKeys: columns, source: { datasetId: "orders", rowKey: "R1" } },
    grid: { colWidthsMm: columns.map(() => 40), cells: [[
      { value: 3, valueType: "number", text: "3.00", numberFormat: "0.00" }, { value: "001", text: "001" },
      { value: false, text: "否" }, { value: "open", text: "open" }, { value: "2026-10-16", text: "2026-10-16" },
      { value: "2026-10-16", text: "2026-10-16", editable: false }, { value: 6, formula: "A1*2", text: "6" }
    ]] }
  }] }] };
}
const fields: Record<string, ReportCellFieldOptions> = {
  qty: { type: "number", label: "数量", hint: "录入净重", unit: "吨", min: 0, max: 10, precision: 2 },
  code: { type: "text", label: "编号", maxLength: 5 }, enabled: { type: "boolean", label: "启用", required: true },
  status: { type: "enum", label: "状态", options: [{ value: "open", label: "进行中" }, { value: "done", label: "已完成" }] },
  date: { type: "date", label: "业务日期", min: "2026-01-01", max: "2026-12-31" },
  protectedDate: { type: "date" }, formula: { type: "number" }
};
async function fixture(options: ReportEditingOptions) {
  const onError = vi.fn();
  const wrapper = mount(ReportPreview, { attachTo: document.body, props: { reportId: "typed", fetcher: async () => plan(), editable: options, onError }, global: { provide: { "mach-report/config": computed(() => ({ defaults: { theme: { toolbarBg: "#fafafa", toolbarFg: "#123456" } }, presets: {} })) } } });
  wrappers.add(wrapper);
  await vi.waitFor(() => expect(wrapper.findAll("td[data-mr-row-index]")).toHaveLength(7));
  const api = wrapper.vm as unknown as MachReportController;
  return { wrapper, api, onError };
}
async function begin(wrapper: VueWrapper, index: number) {
  await wrapper.find(`td[data-mr-column-index="${index}"]`).trigger("dblclick");
  await flushPromises();
  return wrapper.find(".mrp-cell-editor");
}

describe("optional typed cell controls", () => {
  it("shows contextual number hints and keeps invalid values editable before any save", async () => {
    const save = vi.fn();
    const { wrapper, api, onError } = await fixture({ fields, save });
    const input = await begin(wrapper, 0);
    expect(input.element.tagName).toBe("INPUT");
    expect(input.attributes("inputmode")).toBe("decimal");
    expect(wrapper.find(".mrp-cell-editor-hint").text()).toContain("录入净重 · 吨 · ≥ 0 · ≤ 10 · 最多 2 位小数");
    expect((input.element as HTMLElement).style.background).toContain("var(--mrp-toolbar-bg");
    await input.setValue("1.234"); await input.trigger("keydown", { key: "Enter" }); await flushPromises();
    expect(input.attributes("aria-invalid")).toBe("true");
    expect(wrapper.find(".mrp-cell-editor-hint").text()).toBe("数量最多保留 2 位小数");
    expect(onError.mock.calls.at(-1)?.[0]).toBe("数量最多保留 2 位小数"); expect(save).not.toHaveBeenCalled();
    await input.setValue("0"); await input.trigger("keydown", { key: "Enter" }); await flushPromises();
    expect(api.getPlan!()!.pages[0]!.components[0]!.grid!.cells[0]![0]!.value).toBe(0); expect(save).toHaveBeenCalledOnce();
  });
  it("preserves booleans, enum business values and explicit business dates", async () => {
    const save = vi.fn();
    const { wrapper, api } = await fixture({ fields, save });
    const bool = await begin(wrapper, 2); expect(bool.element.tagName).toBe("SELECT");
    await bool.setValue("1"); await bool.trigger("keydown", { key: "Enter" }); await flushPromises();
    expect(save.mock.calls[0]?.[0].value).toBe(true);
    const status = await begin(wrapper, 3); expect(status.findAll("option").map((option) => option.text())).toEqual(["—", "进行中", "已完成"]);
    await status.setValue("2"); await status.trigger("keydown", { key: "Tab" }); await flushPromises();
    expect(save.mock.calls[1]?.[0].value).toBe("done");
    const date = await begin(wrapper, 4); expect(date.attributes("type")).toBe("date");
    await date.setValue("2026-11-01"); await date.trigger("keydown", { key: "Enter" }); await flushPromises();
    expect(save.mock.calls[2]?.[0].value).toBe("2026-11-01");
    expect(api.getChanges!()).toHaveLength(3);
    expect((await begin(wrapper, 5)).exists()).toBe(false); expect((await begin(wrapper, 6)).exists()).toBe(false);
  });
  it("uses a resolver without granting permissions and reports exact configuration errors", async () => {
    const { wrapper, onError } = await fixture({ fields: (context) => context.source?.field === "qty" ? { type: "date", label: "数量" } : fields[context.source!.field] });
    expect((await begin(wrapper, 0)).exists()).toBe(false);
    expect(onError.mock.calls.at(-1)?.[0]).toBe("数量的编辑器与数据类型不一致");
    expect((await begin(wrapper, 5)).exists()).toBe(false);
  });
  it("keeps IME Enter and Shift+Enter in the text editor, Esc cancels without saving", async () => {
    const save = vi.fn(); const { wrapper } = await fixture({ fields, save });
    const input = await begin(wrapper, 1); await input.setValue("00009");
    await input.trigger("keydown", { key: "Enter", isComposing: true }); await input.trigger("keydown", { key: "Enter", shiftKey: true });
    expect(save).not.toHaveBeenCalled(); expect(input.exists()).toBe(true);
    await input.trigger("keydown", { key: "Escape" }); expect(wrapper.find(".mrp-cell-editor").exists()).toBe(false); expect(save).not.toHaveBeenCalled();
  });
  it("applies field restrictions atomically to paste, undo and all persistence paths", async () => {
    const saveBatch = vi.fn(); const { wrapper, api } = await fixture({ fields, saveBatch });
    await wrapper.find('td[data-mr-column-index="0"]').trigger("click");
    expect(await api.pasteSelection!("11\tvalid")).toBe(false); expect(saveBatch).not.toHaveBeenCalled();
    expect(await api.pasteSelection!("4\t00004")).toBe(true); expect(saveBatch).toHaveBeenCalledOnce();
    expect(saveBatch.mock.calls[0]?.[0].edits.map((edit: { value: unknown }) => edit.value)).toEqual([4, "00004"]);
    expect(await api.undo!()).toBe(true); expect(saveBatch).toHaveBeenCalledTimes(2);
  });
});

describe("local drafts are distinct from saved differences", () => {
  it("only counts an active input once its value changes and clears active state on cancellation", async () => {
    const scope = effectScope(); const currentPlan = ref<RenderPlan | null>(plan());
    const options = ref<boolean | ReportEditingOptions>({ fields, save: vi.fn() });
    const editing = scope.run(() => useCellEditing({ plan: currentPlan, options, blocked: () => false, label: () => "编辑单元格", onChange: vi.fn(), onError: vi.fn() }))!;
    const holder = document.createElement("div"); holder.className = "mrp-page-holder"; holder.dataset.page = "1";
    holder.innerHTML = '<div data-mr-component-index="0"><table><tbody><tr><td data-mr-row-index="0" data-mr-column-index="0"></td></tr></tbody></table></div>';
    document.body.append(holder); const cell = holder.querySelector("td")!;
    await editing.editCell(cell); expect(editing.pendingLocalChanges.value).toBe(false);
    const input = holder.querySelector<HTMLInputElement>("input")!;
    input.value = "4"; input.dispatchEvent(new Event("input")); expect(editing.pendingLocalChanges.value).toBe(true);
    input.value = "3"; input.dispatchEvent(new Event("input")); expect(editing.pendingLocalChanges.value).toBe(false);
    input.value = "4"; input.dispatchEvent(new Event("input")); expect(await editing.commit()).toBe(true);
    expect(editing.differences.value).toHaveLength(1); expect(editing.pendingLocalChanges.value).toBe(false);
    await editing.editCell(cell); const second = holder.querySelector<HTMLInputElement>("input")!;
    second.value = "5"; second.dispatchEvent(new Event("input")); expect(editing.pendingLocalChanges.value).toBe(true);
    editing.cancel(); expect(editing.pendingLocalChanges.value).toBe(false); expect(holder.querySelector("input")).toBeNull();
    scope.stop();
  });
  it("tracks local net changes, clears them on undo and excludes successful persisted writes", async () => {
    const scope = effectScope();
    const currentPlan = ref<RenderPlan | null>(plan()); const options = ref<boolean | ReportEditingOptions>(true);
    const history = scope.run(() => useEditHistory({ plan: currentPlan, options, blocked: () => false, onChange: vi.fn(), onError: vi.fn() }))!;
    const address = { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 };
    expect(await history.apply([{ address, value: 4 }])).toBe(true); expect(history.hasLocalDrafts.value).toBe(true);
    expect(await history.undo()).toBe(true); expect(history.hasLocalDrafts.value).toBe(false);
    await history.redo(); options.value = { save: vi.fn() };
    expect(await history.apply([{ address, value: 5 }])).toBe(true);
    expect(history.differences.value).toHaveLength(1); expect(history.hasLocalDrafts.value).toBe(false);
    options.value = { save: vi.fn().mockRejectedValue(new Error("offline")) };
    expect(await history.apply([{ address, value: 6 }])).toBe(false); expect(history.hasLocalDrafts.value).toBe(false);
    scope.stop();
  });
});
