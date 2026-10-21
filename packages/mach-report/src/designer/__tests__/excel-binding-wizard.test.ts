import { describe, expect, it, vi } from "vitest";
import { defineComponent, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import type { ExcelImportResult } from "../../xlsx/import-types";
import type {
  ExcelBindingDataset,
  ExcelBindingRecipe,
  ExcelBindingSession,
} from "../../xlsx/binding-workflow";
import {
  useExcelBindingWizard,
  type ExcelBindingWizardOptions,
} from "../useExcelBindingWizard";
import { RENDER_PLAN_SCHEMA_VERSION } from "../../schema/render-plan";
import ExcelBindingWizard from "../ExcelBindingWizard.vue";
import type { ExcelRegionBindingSession } from "../../xlsx/region-binding-types";
const load = vi.hoisted(() => vi.fn());
const opened = vi.hoisted(() => vi.fn());
const disposed = vi.hoisted(() => vi.fn());
vi.mock("../../xlsx/workbook-session", () => ({
  openExcelWorkbook: (...args: unknown[]) => {
    opened(...args);
    return Promise.resolve({ disposed: false, dispose: disposed,
      inspect: () => ({ sheets: [{ name: "日报", index: 1, visible: true }, { name: "第二页", index: 2, visible: true }] }),
      importTemplate: (...args: unknown[]) => load(...args),
    });
  },
}));
const source: ExcelImportResult = {
  warnings: [],
  sheets: [
    {
      name: "日报",
      index: 1,
      range: "A1:B4",
      rowCount: 4,
      columnCount: 2,
      pageStart: 0,
      pageCount: 1,
    },
  ],
  template: {
    schemaVersion: RENDER_PLAN_SCHEMA_VERSION,
    pages: [
      {
        widthMm: 60,
        heightMm: 100,
        layout: "wide",
        components: [
          {
            kind: "rect",
            leftMm: 0,
            topMm: 0,
            widthMm: 60,
            heightMm: 24,
            meta: { xlsxSheet: "日报", xlsxRange: "A1:B4" },
            grid: {
              colWidthsMm: [30, 30],
              rowHeightsMm: [6, 6, 6, 6],
              cells: [
                [{ text: "日报", colSpan: 2 }],
                [{ text: "编号" }, { text: "重量" }],
                [{ text: "SAMPLE" }, { text: "999" }],
                [{ text: "SAMPLE" }, { text: "999" }],
              ],
            },
          },
        ],
      },
    ],
  },
};
const datasets: ExcelBindingDataset[] = [
  {
    id: "rows",
    fields: [
      { field: "id", type: "text", semanticRole: "identifier" },
      { field: "weight", type: "number", unit: "kg", digits: 3, sample: 0 },
    ],
  },
];
const recipe: ExcelBindingRecipe = {
  version: "1.0",
  sheet: "日报",
  dataset: "rows",
  regions: { title: "A1:B1", header: "A2:B2", detail: "A3:B4" },
  fields: ["id", "weight"],
  rowKey: "id",
};
function session(): ExcelBindingSession {
  return {
    version: "1.0",
    source: structuredClone(source),
    recipe: structuredClone(recipe),
    identity: { id: "new", name: "新日报" },
  };
}
function harness(options: ExcelBindingWizardOptions) {
  let wizard!: ReturnType<typeof useExcelBindingWizard>;
  const emitted = vi.fn();
  const state = reactive(options);
  const wrapper = mount(
    defineComponent({
      setup() {
        wizard = useExcelBindingWizard(state, emitted);
        return () => null;
      },
    }),
  );
  return { wizard, emitted, wrapper, state };
}
function guidanceSession(): { session: ExcelRegionBindingSession; datasets: ExcelBindingDataset[] } {
  const imported = structuredClone(source);
  Object.assign(imported.sheets[0]!, { range: "A1:Z40", rowCount: 40, columnCount: 26 });
  const component = imported.template.pages[0]!.components[0]!;
  if (component.kind !== "rect") throw new Error("Expected source grid");
  Object.assign(component, { widthMm: 780, heightMm: 240, meta: { xlsxSheet: "日报", xlsxRange: "A1:Z40" }, grid: { colWidthsMm: Array(26).fill(30), rowHeightsMm: Array(40).fill(6), cells: Array.from({ length: 40 }, () => Array.from({ length: 26 }, () => ({ text: "" }))) } });
  imported.template.pages[0]!.widthMm = 780; imported.template.pages[0]!.heightMm = 300;
  const fields = [...datasets[0]!.fields, ...Array.from({ length: 12 }, (_, index) => ({ field: `f${index + 2}`, type: "number" as const }))];
  return { datasets: [{ id: "rows", fields }], session: { version: "2.0", source: imported, identity: { id: "guided", name: "定位测试" }, recipe: { version: "2.0", sheet: "日报", regions: [
    { id: "production", range: "A3:B3", mode: "record", dataset: "rows", rowKey: "id", fields: ["id", "weight"] },
    { id: "cost", range: "M30:Z30", mode: "record", dataset: "rows", rowKey: "", fields: fields.map((field, index) => index === 13 ? "" : field.field) },
  ] } } };
}
describe("Excel binding wizard interaction", () => {
  it("locates a multi-region issue across source and field windows, then updates pending regions to ready", async () => {
    const options = guidanceSession();
    const wrapper = mount(ExcelBindingWizard, { props: options, attachTo: document.body });
    const directory = wrapper.findAll(".mr-binding-region-entry");
    expect(directory.map(item => item.attributes("data-state"))).toEqual(["ready", "pending"]);
    expect(wrapper.get(".mr-binding-primary").attributes("title")).toContain("逐列字段映射");
    await wrapper.findAll("button").find(button => button.text() === "校验绑定")!.trigger("click");
    expect(wrapper.get(".mr-binding-issues").text()).not.toContain("$.recipe");
    await wrapper.get('button[aria-label="定位并修正 · cost · 逐列映射 Z"]').trigger("click");
    await flushPromises();
    expect(directory[1]!.classes()).toContain("is-active");
    expect((wrapper.get('input[aria-label="预览起始行"]').element as HTMLInputElement).value).toBe("30");
    expect((wrapper.get('input[aria-label="预览起始列"]').element as HTMLInputElement).value).toBe("26");
    expect(wrapper.get('td[data-source-cell="30:26"]').classes()).toContain("is-cell-selected");
    const mapping = wrapper.get('select[aria-label="Excel 列 Z · 业务字段"]');
    expect(document.activeElement).toBe(mapping.element);
    expect(wrapper.findAll(".mr-binding-map")).toHaveLength(2);
    expect(wrapper.findAll(".mr-binding-grid td").length).toBeLessThanOrEqual(24 * 12);
    await mapping.setValue("f13");
    await wrapper.findAll("button").find(button => button.text() === "校验绑定")!.trigger("click");
    await wrapper.get('button[aria-label="定位并修正 · cost · 稳定业务主键"]').trigger("click"); await flushPromises();
    const key = wrapper.get('.mr-binding-multi select[aria-label="稳定业务主键"]');
    expect(document.activeElement).toBe(key.element);
    await key.setValue("id");
    expect(directory[1]!.attributes("data-state")).toBe("ready");
    expect(wrapper.get(".mr-binding-primary").attributes("disabled")).toBeUndefined();
    expect(wrapper.get(".mr-binding-actions").text()).toContain("绑定校验通过");
    wrapper.unmount();
  });
  it("marks geometric errors separately and permits read-only diagnostic navigation without changing the draft", async () => {
    const options = guidanceSession();
    options.session.recipe.regions[1]!.range = "A3:N3";
    const wrapper = mount(ExcelBindingWizard, { props: { ...options, readonly: true }, attachTo: document.body });
    expect(wrapper.findAll(".mr-binding-region-entry")[1]!.attributes("data-state")).toBe("error");
    await wrapper.findAll("button").find(button => button.text() === "校验绑定")!.trigger("click");
    expect(wrapper.get(".mr-binding-issues").text()).not.toContain("$.recipe");
    await wrapper.get('button[aria-label="定位并修正 · cost · 原型范围"]').trigger("click"); await flushPromises();
    expect(wrapper.get('.mr-binding-multi input[aria-label="原型范围"]').element).toHaveProperty("value", "A3:N3");
    const exposed = wrapper.vm as unknown as { pendingLocalChanges: boolean };
    expect(exposed.pendingLocalChanges).toBe(false);
    expect(document.activeElement?.tagName).toBe("LABEL");
    const range = wrapper.get('.mr-binding-multi input[aria-label="原型范围"]');
    await range.setValue("A4:N4");
    const key = wrapper.get('.mr-binding-multi select[aria-label="稳定业务主键"]');
    await key.setValue("id");
    expect(exposed.pendingLocalChanges).toBe(false);
    expect(wrapper.get(".mr-binding-primary").attributes("disabled")).toBeDefined();
    expect(wrapper.emitted("apply")).toBeUndefined();
    wrapper.unmount();
  });
  it("marks every region that shares an invalid sample contract and guards stale read-only field events", async () => {
    const options = guidanceSession();
    options.datasets[0]!.samples = [{ id: "duplicate", weight: 1 }, { id: "duplicate", weight: 2 }];
    const { wizard, wrapper, state } = harness(options);
    expect(wizard.regionBindings.directory.value.map(entry => entry.state)).toEqual(["error", "error"]);
    const issue = wizard.validation.value.issues.find(item => item.code === "row-key")!;
    expect(wizard.regionBindings.target(issue)).toMatchObject({ regionId: "production", control: "rowKey" });
    state.readonly = true;
    const before = JSON.stringify(wizard.regionBindings.recipe.value);
    wizard.regionBindings.property("rowKey", "weight"); wizard.regionBindings.property("mode", "repeat");
    wizard.regionBindings.mapping(0, "weight"); wizard.regionBindings.clearHeader();
    expect(JSON.stringify(wizard.regionBindings.recipe.value)).toBe(before);
    expect(wizard.pendingLocalChanges.value).toBe(false);
    wrapper.unmount();
  });
  it("reuses one workbook owner when switching Sheets and retains independent region drafts in dirty protection", async () => {
    const other = structuredClone(source); other.sheets[0]!.name = "第二页";
    for (const component of other.template.pages[0]!.components) if (component.kind !== "list" && component.meta) component.meta.xlsxSheet = "第二页";
    load.mockReset().mockResolvedValueOnce(source).mockResolvedValueOnce(other).mockResolvedValueOnce(source);
    opened.mockClear(); disposed.mockClear();
    const { wizard, wrapper } = harness({ datasets });
    await wizard.importFile(new File(["data"], "regions.xlsx"));
    wizard.mode.value = "regions"; wizard.regionBindings.select(3, 1, false); wizard.regionBindings.select(3, 2, true); wizard.regionBindings.add(); wizard.regionBindings.dataset("rows");
    wizard.regionBindings.active.value!.fields = ["id", "weight"]; wizard.regionBindings.active.value!.rowKey = "id";
    const original = JSON.stringify(wizard.regionBindings.recipe.value);
    await wizard.chooseSheet("第二页");
    expect(wizard.regionBindings.recipe.value.sheet).toBe("第二页"); expect(wizard.regionBindings.recipe.value.regions).toEqual([]);
    wizard.regionBindings.select(4, 1, false); wizard.regionBindings.select(4, 2, true); wizard.regionBindings.add();
    await wizard.chooseSheet("日报");
    expect(JSON.stringify(wizard.regionBindings.recipe.value)).toBe(original);
    expect(wizard.pendingLocalChanges.value).toBe(true);
    expect(opened).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(3);
    wrapper.unmount(); expect(disposed).toHaveBeenCalledTimes(1);
  });
  it("creates two independent same-Sheet regions by real cell selection and survives an application veto", async () => {
    const accept = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const wrapper = mount(ExcelBindingWizard, { props: { datasets, session: session(), accept } });
    await wrapper.findAll("button").find(button => button.text().includes("多区域绑定"))!.trigger("click");
    async function selectRange(row: number): Promise<void> {
      await wrapper.get(`td[data-source-cell="${row}:1"]`).trigger("keydown", { key: "Enter" });
      await wrapper.get(`td[data-source-cell="${row}:2"]`).trigger("keydown", { key: "Enter", shiftKey: true });
      await wrapper.get(".mr-binding-add-region").trigger("click");
      await wrapper.get('.mr-binding-multi select[aria-label="业务数据集"]').setValue("rows");
      await wrapper.get('.mr-binding-multi select[aria-label="稳定业务主键"]').setValue("id");
      await wrapper.get('.mr-binding-multi select[aria-label="Excel 列 A · 业务字段"]').setValue("id");
      await wrapper.get('.mr-binding-multi select[aria-label="Excel 列 B · 业务字段"]').setValue("weight");
    }
    await selectRange(3);
    await wrapper.get('.mr-binding-multi select[aria-label="填充方式"]').setValue("record");
    await selectRange(4);
    expect(wrapper.findAll(".mr-binding-region-entry")).toHaveLength(2);
    expect(wrapper.text()).toContain("A4:B4");
    const apply = wrapper.findAll("button").find(button => button.text() === "校验并使用模板")!;
    expect(apply.attributes("disabled")).toBeUndefined();
    await apply.trigger("click"); await flushPromises();
    expect(accept).toHaveBeenCalledTimes(1);
    expect((wrapper.vm as unknown as { pendingLocalChanges: boolean }).pendingLocalChanges).toBe(true);
    const candidate = accept.mock.calls[0]![0];
    expect(candidate.session.version).toBe("2.0");
    expect(candidate.recipe.regions).toEqual([
      { id: "region-1", range: "A3:B3", dataset: "rows", mode: "record", rowKey: "id", fields: ["id", "weight"] },
      { id: "region-2", range: "A4:B4", dataset: "rows", mode: "repeat", rowKey: "id", fields: ["id", "weight"] },
    ]);
    expect(JSON.stringify(candidate.document)).not.toContain("SAMPLE");
    await apply.trigger("click"); await flushPromises();
    expect((wrapper.vm as unknown as { pendingLocalChanges: boolean }).pendingLocalChanges).toBe(false);
    expect(wrapper.text()).toContain("模板已生成，等待接入方确认");
    wrapper.unmount();
  });
  it("reopens version 2 mappings, preserves them across mode switches, and readonly guards all region actions", async () => {
    const multi = { version: "2.0" as const, source: structuredClone(source), identity: { id: "multi", name: "区域日报" }, recipe: { version: "2.0" as const, sheet: "日报", regions: [{ id: "cost", range: "A3:B3", mode: "repeat" as const, dataset: "rows", fields: ["id", "weight"], rowKey: "id" }] } };
    const { wizard, wrapper, state } = harness({ datasets, session: multi });
    expect(wizard.mode.value).toBe("regions"); expect(wizard.regionBindings.recipe.value).toEqual(multi.recipe);
    wizard.regionBindings.select(4, 1, false); wizard.regionBindings.select(4, 2, true); wizard.regionBindings.add();
    wizard.mode.value = "table"; wizard.mode.value = "regions";
    expect(wizard.regionBindings.recipe.value.regions).toHaveLength(2);
    state.readonly = true;
    const before = JSON.stringify(wizard.regionBindings.recipe.value);
    wizard.regionBindings.remove("cost"); wizard.regionBindings.dataset("other"); wizard.regionBindings.header(); wizard.regionBindings.footer(); wizard.regionBindings.clearFooter(); wizard.regionBindings.add();
    expect(JSON.stringify(wizard.regionBindings.recipe.value)).toBe(before);
    wrapper.unmount();
  });
  it("bounds large field catalogues and searches labels, codes and units without dropping already selected mappings", async () => {
    const fields = [{ field: "id", type: "text" as const }, ...Array.from({ length: 1000 }, (_, index) => ({ field: `field${index}`, label: `指标 ${index}`, type: "number" as const, ...(index === 999 ? { unit: "特殊单位" } : {}) }))];
    const multi = { version: "2.0" as const, source: structuredClone(source), identity: { id: "multi", name: "大字段目录" }, recipe: { version: "2.0" as const, sheet: "日报", regions: [{ id: "cost", range: "A3:B3", mode: "repeat" as const, dataset: "large", fields: ["id", "field500"], rowKey: "id" }] } };
    const wrapper = mount(ExcelBindingWizard, { props: { datasets: [{ id: "large", fields }], session: multi } });
    const panel = wrapper.get(".mr-binding-multi");
    expect(panel.findAll(".mr-binding-map select option").length).toBeLessThan(140);
    const selected = panel.get('select[aria-label="Excel 列 B · 业务字段"]');
    expect((selected.element as HTMLSelectElement).value).toBe("field500");
    await panel.get('input[aria-label="搜索字段名称、编码或单位"]').setValue("特殊单位");
    expect(selected.find('option[value="field999"]').exists()).toBe(true);
    expect(selected.find('option[value="field500"]').exists()).toBe(true);
    await selected.setValue("field999");
    expect((selected.element as HTMLSelectElement).value).toBe("field999");
    wrapper.unmount();
  });
  it("graphic row selection and explicit mappings create a new document with a reopenable session", async () => {
    const { wizard, wrapper, emitted } = harness({
      datasets,
      session: session(),
    });
    wizard.chooseRow(3, false);
    wizard.chooseRow(4, true);
    wizard.markRegion("detail");
    expect(wizard.selection.value).toEqual({ top: 3, bottom: 4 });
    wizard.apply();
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(emitted.mock.calls[0]![0]).toMatchObject({
      document: { id: "new" },
      recipe,
      session: { recipe },
    });
    expect(JSON.stringify(emitted.mock.calls[0]![0].document)).not.toContain(
      "SAMPLE",
    );
    wizard.chooseDataset("rows");
    expect(wizard.recipe.value.fields).toEqual(["", ""]);
    expect(wizard.recipe.value.rowKey).toBe("");
    wizard.apply();
    expect(emitted).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it("a stale async load cannot replace a later file and cancellation has no late commit", async () => {
    let complete!: (value: ExcelImportResult) => void;
    load
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ...source,
        sheets: [{ ...source.sheets[0]!, name: "最新" }],
      });
    const { wizard, wrapper } = harness({ datasets });
    const first = wizard.importFile(new File(["one"], "first.xlsx"));
    await flushPromises();
    const second = wizard.importFile(new File(["two"], "second.xlsx"));
    await second;
    complete(source);
    await first;
    expect(wizard.sourceName.value).toBe("second.xlsx");
    expect(wizard.recipe.value.sheet).toBe("最新");
    load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = wizard.importFile(new File(["three"], "third.xlsx"));
    await flushPromises();
    wizard.cancel();
    complete(source);
    await pending;
    expect(wizard.sourceName.value).toBe("second.xlsx");
    expect(wizard.loading.value).toBe(false);
    wrapper.unmount();
  });
  it("read-only guards source replacement, regions, mappings and apply, preserving the loaded source", () => {
    const options = { datasets, session: session(), readonly: false };
    const { wizard, wrapper, emitted, state } = harness(options);
    state.readonly = true;
    wizard.chooseDataset("other");
    wizard.chooseRow(1, false);
    wizard.markRegion("header");
    wizard.setMapping(0, "weight");
    wizard.apply();
    expect(wizard.recipe.value).toEqual(recipe);
    expect(emitted).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("mount preserves semantic table, keyboard row selection, contract metadata and disabled apply until explicit mapping", async () => {
    const wrapper = mount(ExcelBindingWizard, {
      props: { datasets, session: session() },
    });
    // Explicit labels must stay exact even though the native select contains multiple options.
    expect(
      (wrapper.get('select[aria-label="工作表"]').element as HTMLSelectElement)
        .value,
    ).toBe("日报");
    expect(
      (
        wrapper.get('select[aria-label="业务数据集"]')
          .element as HTMLSelectElement
      ).value,
    ).toBe("rows");
    expect(
      (
        wrapper.get('select[aria-label="稳定业务主键"]')
          .element as HTMLSelectElement
      ).value,
    ).toBe("id");
    const row = wrapper.get('button[data-source-row="3"]');
    await row.trigger("keydown", { key: "Enter" });
    await wrapper
      .get('button[data-source-row="4"]')
      .trigger("keydown", { key: "Enter", shiftKey: true });
    await wrapper
      .get('button[aria-label="标记选中行 · 样例明细"]')
      .trigger("click");
    expect(wrapper.text()).toContain("A3:B4");
    expect(wrapper.text()).toContain("number · kg · 3位小数 · 契约样例: 0");
    expect(wrapper.findAll("td")).toHaveLength(7);
    await wrapper
      .get('select[aria-label="Excel 列 A · 业务字段"]')
      .setValue("");
    expect(
      wrapper.get(".mr-binding-primary").attributes("disabled"),
    ).toBeDefined();
    wrapper.unmount();
  });
  it("file validation and unmount abort avoid an error cascade", async () => {
    const { wizard, wrapper } = harness({ datasets });
    await wizard.importFile(new File([""], "bad.csv"));
    expect(wizard.error.value).toMatch(/xlsx/);
    let complete!: (value: ExcelImportResult) => void;
    load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = wizard.importFile(new File([""], "good.xlsx"));
    await flushPromises();
    wrapper.unmount();
    complete(source);
    await pending;
    expect(wizard.imported.value).toBeUndefined();
  });
});

describe("binding session and acceptance closure", () => {
  it("one workbook owner serves sheet changes and releases only on replacement or unmount", async () => {
    const beforeOpen = opened.mock.calls.length, beforeDispose = disposed.mock.calls.length;
    load.mockResolvedValueOnce(source).mockResolvedValueOnce({ ...source, sheets: [{ ...source.sheets[0]!, name: "第二页" }] }).mockResolvedValueOnce(source);
    const { wizard, wrapper } = harness({ datasets });
    await wizard.importFile(new File(["xlsx"], "multi.xlsx"));
    wizard.chooseDataset("rows"); wizard.setMapping(0, "id");
    await wizard.chooseSheet("第二页");
    expect(opened.mock.calls.length - beforeOpen).toBe(1);
    expect(load.mock.calls.at(-1)![0]).toMatchObject({ sheets: ["第二页"] });
    await wizard.chooseSheet("日报"); expect(wizard.recipe.value.fields[0]).toBe("id");
    expect(opened.mock.calls.length - beforeOpen).toBe(1);
    expect(disposed.mock.calls.length - beforeDispose).toBe(0);
    expect(wizard.pendingLocalChanges.value).toBe(true);
    wrapper.unmount(); expect(disposed.mock.calls.length - beforeDispose).toBe(1);
  });
  it("declined asynchronous replacement keeps dirty state and never reports applied", async () => {
    const accept = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { wizard, wrapper, emitted } = harness({ datasets, session: session(), accept });
    wizard.identity.value.name = "修改后的绑定";
    expect(wizard.pendingLocalChanges.value).toBe(true);
    await wizard.apply(); expect(wizard.applied.value).toBe(false); expect(wizard.pendingLocalChanges.value).toBe(true); expect(emitted).not.toHaveBeenCalled();
    await wizard.apply(); expect(wizard.applied.value).toBe(true); expect(wizard.pendingLocalChanges.value).toBe(false); expect(accept).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
