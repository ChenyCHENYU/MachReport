// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { RenderPlan } from "@agile-team/mach-report";
import ReportPreview from "../ReportPreview.vue";
import ReportSettings from "../ReportSettings.vue";
import type { MachReportController } from "../controller";
import { defineMachReportConfig, resolveConfig } from "../config";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function plan(): RenderPlan {
  return { schemaVersion: "test", pages: [{ layout: "wide", pageWidthMm: 1400, pageHeightMm: 90, components: [
    { kind: "text", leftMm: 10, topMm: 5, widthMm: 100, heightMm: 10, text: "真实报表表头" },
    { kind: "rect", leftMm: 10, topMm: 20, widthMm: 80, heightMm: 10, grid: {
      colWidthsMm: [80], cells: [[{ value: 5, text: "5.00", numberFormat: "0.00" }]]
    } }
  ] }] };
}

function create(props: Record<string, unknown> = {}) {
  const wrapper = mount(ReportPreview, {
    props: { reportId: "A", fetcher: async () => plan(), ...props },
    slots: { settings: "<div>宿主显示版式</div>" }, attachTo: document.body
  });
  wrappers.push(wrapper);
  return wrapper;
}

async function open(wrapper: VueWrapper, section: "general" | "tools" = "tools") {
  await wrapper.find(".mrp-settings-toggle").trigger("click");
  if (section === "tools") await wrapper.find('[role="tab"][id$="-tools"]').trigger("click");
  return wrapper.findComponent(ReportSettings);
}

function option(wrapper: VueWrapper, label: string) {
  return wrapper.findAll(".mrp-settings-option").find((item) => item.text().startsWith(label))!.find("input");
}

describe("ReportPreview settings and explicit empty result", () => {
  it("keeps settings and import discoverable without a report, supports the host slot and keyboard close", async () => {
    const wrapper = create({ autoLoad: false, excelImport: true });
    const toggle = wrapper.find(".mrp-settings-toggle");
    (toggle.element as HTMLElement).focus();
    await open(wrapper, "general");
    expect(wrapper.find("[role='dialog']").attributes("aria-modal")).toBe("true");
    expect(wrapper.text()).toContain("宿主显示版式");
    await wrapper.find('[role="tab"][id$="-tools"]').trigger("click");
    expect(option(wrapper, "导入 Excel 模板").attributes("disabled")).toBeUndefined();
    await wrapper.find(".mrp-settings-backdrop").trigger("keydown", { key: "Escape" });
    expect(wrapper.find("[role='dialog']").exists()).toBe(false);
    expect(document.activeElement).toBe(toggle.element);
    expect(wrapper.find(".mrp-import-excel").exists()).toBe(true);
  });

  it("closes Escape after focus is lost, restores the Safari mouse opener and removes its document listener", async () => {
    const wrapper = create({ autoLoad: false });
    const toggle = wrapper.find(".mrp-settings-toggle");
    // Mouse clicks on Safari buttons do not necessarily focus the opener.
    await open(wrapper);
    (document.activeElement as HTMLElement).blur();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flushPromises();
    expect(wrapper.find("[role='dialog']").exists()).toBe(false);
    expect(document.activeElement).toBe(toggle.element);
    const next = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(next); expect(next.defaultPrevented).toBe(false);
  });

  it("does not steal Escape from another modal and traps Tab back into its own modal when focus was lost", async () => {
    const wrapper = create({ autoLoad: false });
    await open(wrapper);
    const other = document.createElement("section"); other.setAttribute("role", "dialog"); other.setAttribute("aria-modal", "true");
    const input = document.createElement("input"); other.append(input); document.body.append(other); input.focus();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    input.dispatchEvent(escape); await flushPromises();
    expect(escape.defaultPrevented).toBe(false);
    expect(wrapper.find("[role='dialog']").exists()).toBe(true);
    other.remove();
    (document.activeElement as HTMLElement).blur();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(wrapper.find(".mrp-settings-close").element);
  });

  it("toggles real output/read tools, resets them and never overrides host capability restrictions", async () => {
    const wrapper = create({ showExport: false, showPrint: false, editable: false, excelImport: false });
    await vi.waitFor(() => expect(wrapper.find("td").exists()).toBe(true));
    await open(wrapper);
    for (const label of ["导出 PDF", "打印", "编辑单元格", "导入 Excel 模板"]) {
      expect(option(wrapper, label).attributes("disabled")).toBeDefined();
    }
    await option(wrapper, "缩略图").setValue(false);
    await flushPromises();
    expect(wrapper.findAll(".mrp-toolbar button").some((button) => button.text().includes("缩略图"))).toBe(false);
    expect(wrapper.emitted("preferences-change")?.at(-1)?.[0]).toMatchObject({ thumbnails: false, pdf: false, editing: false });
    await wrapper.find(".mrp-settings-panel footer button").trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".mrp-toolbar button").some((button) => button.text().includes("缩略图"))).toBe(true);
    expect(wrapper.findAll(".mrp-toolbar button").some((button) => button.text().includes("导出 PDF"))).toBe(false);
  });

  it("supports individually permitted export formats and local editing/import initial preferences", async () => {
    const wrapper = create({ editable: true, excelImport: true, toolbar: { exportFormats: ["xlsx", "html"], editing: false, excelImport: false } });
    await vi.waitFor(() => expect(wrapper.find("td").exists()).toBe(true));
    await wrapper.find("td").trigger("dblclick");
    expect(wrapper.find(".mrp-cell-editor").exists()).toBe(false);
    expect(wrapper.find(".mrp-import-excel").exists()).toBe(false);
    await open(wrapper);
    expect(option(wrapper, "导出 PDF").attributes("disabled")).toBeDefined();
    expect(option(wrapper, "编辑单元格").attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).toContain("本地草稿");
    await option(wrapper, "编辑单元格").setValue(true);
    await option(wrapper, "导入 Excel 模板").setValue(true);
    await wrapper.find(".mrp-settings-close").trigger("click");
    expect(wrapper.find(".mrp-import-excel").exists()).toBe(true);
    await wrapper.find("td").trigger("dblclick");
    await vi.waitFor(() => expect(wrapper.find(".mrp-cell-editor").exists()).toBe(true));
  });

  it("commits before disabling editing, preserves confirmed changes, and exports the modified current plan", async () => {
    const wrapper = create({ editable: true });
    await vi.waitFor(() => expect(wrapper.find("td").exists()).toBe(true));
    const settings = await open(wrapper);
    await wrapper.find("td").trigger("dblclick");
    await vi.waitFor(() => expect(wrapper.find(".mrp-cell-editor").exists()).toBe(true));
    (wrapper.find("textarea").element as HTMLTextAreaElement).value = "0";
    settings.vm.$emit("change", "editing", false);
    await vi.waitFor(() => expect(wrapper.find("textarea").exists()).toBe(false));
    const controller = wrapper.vm as unknown as MachReportController;
    expect(controller.getChanges!()).toHaveLength(1);
    expect(controller.getPlan!()!.pages[0]!.components[1]!.grid!.cells[0]![0]!.value).toBe(0);
    const xlsx = await import("@agile-team/mach-report/xlsx");
    const render = vi.spyOn(xlsx, "renderPlanToXlsx").mockResolvedValue({ workbook: {} as never, buffer: new ArrayBuffer(2), warnings: [] });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:settings-edited");
    await controller.exportAs("xlsx");
    expect(render.mock.calls[0]![0].pages[0]!.components[1]!.grid!.cells[0]![0]!.value).toBe(0);
    settings.vm.$emit("change", "editing", true);
    await flushPromises();
    expect(controller.getChanges!()).toHaveLength(1);
  });

  it("retains editing and the invalid input when validation prevents disabling or reset", async () => {
    const wrapper = create({ editable: { validate: () => "业务校验失败" }, toolbar: { editing: true } });
    await vi.waitFor(() => expect(wrapper.find("td").exists()).toBe(true));
    const settings = await open(wrapper);
    await wrapper.find("td").trigger("dblclick");
    await vi.waitFor(() => expect(wrapper.find("textarea").exists()).toBe(true));
    (wrapper.find("textarea").element as HTMLTextAreaElement).value = "8";
    settings.vm.$emit("change", "editing", false);
    await vi.waitFor(() => expect(wrapper.text()).toContain("业务校验失败"));
    expect(wrapper.find("textarea").exists()).toBe(true);
    expect((option(wrapper, "编辑单元格").element as HTMLInputElement).checked).toBe(true);
    settings.vm.$emit("reset");
    await flushPromises();
    expect(wrapper.find("textarea").exists()).toBe(true);
    expect((wrapper.vm as unknown as MachReportController).getChanges!()).toEqual([]);
  });

  it("places the explicit zero-row SVG outside the wide scale while preserving the report header", async () => {
    const wrapper = create({ emptyState: { title: "暂无实绩", description: "YTS0 · 2026-10-15 · 0 条" } });
    await vi.waitFor(() => expect(wrapper.find(".mr-page").exists()).toBe(true));
    const empty = wrapper.find(".mrp-empty");
    expect(empty.find("svg").exists()).toBe(true);
    expect(empty.element.closest(".mrp-scale")).toBeNull();
    expect(empty.element.parentElement?.classList.contains("mrp-body")).toBe(true);
    expect(empty.text()).toContain("YTS0 · 2026-10-15");
    expect(wrapper.text()).toContain("真实报表表头");
    await wrapper.setProps({ emptyState: false });
    expect(wrapper.find(".mrp-empty").exists()).toBe(false);
  });

  it("merges toolbar fields through defaults and preset without changing old opt-in editing", () => {
    const config = defineMachReportConfig({ defaults: { toolbar: { search: false, editing: false } }, presets: { report: { toolbar: { exportFormats: ["xlsx"] } } } });
    expect(resolveConfig(config, "report").toolbar).toEqual({ search: false, editing: false, exportFormats: ["xlsx"] });
    expect(resolveConfig(config).showSettings).toBe(true);
    expect(resolveConfig(config).editable).toBe(false);
  });
});
