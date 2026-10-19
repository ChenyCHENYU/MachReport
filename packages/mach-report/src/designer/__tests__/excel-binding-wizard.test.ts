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
const load = vi.hoisted(() => vi.fn());
vi.mock("../../xlsx/import-template", () => ({
  importExcelTemplate: load,
  inspectExcelWorkbook: async () => ({
    sheets: [{ name: "日报", index: 1, visible: true }],
  }),
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
describe("Excel binding wizard interaction", () => {
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
