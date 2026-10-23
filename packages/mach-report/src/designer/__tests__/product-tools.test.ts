import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  createTableTemplate,
  defineReportTemplate,
  type ListComponent,
  type ReportTemplateDocument,
} from "../../index";
import {
  applyReportDocumentStyle,
  captureTemplateFragment,
  insertTemplateFragment,
  inspectTemplateFragmentBindings,
} from "../../source/template-fragments";
import {
  collectTemplateOutline,
  inspectTemplateFieldUsage,
} from "../../source/template-outline";
import TemplateOutlinePanel from "../TemplateOutlinePanel.vue";
import TemplateReusePanel from "../TemplateReusePanel.vue";
import TemplateReviewPanel from "../TemplateReviewPanel.vue";
import { compareTemplateFixture } from "../review-comparison";
import { snapshotFixtureData } from "../fixture-snapshot";
import { useTemplateColumns } from "../useTemplateColumns";

function label(): ReportTemplateDocument {
  return defineReportTemplate({
    id: "labels",
    name: "Labels",
    revision: "4",
    template: {
      repeat: { dataset: "records" },
      pages: [
        {
          widthMm: 80,
          heightMm: 55,
          components: [
            {
              kind: "text",
              nid: "original",
              rkey: "private",
              leftMm: 4,
              topMm: 5,
              widthMm: 45,
              heightMm: 8,
              text: "Product",
              binding: { field: "serial" },
              style: { fontSize: 10 },
              meta: { labelSource: { pageIndex: 0 } },
            },
          ],
        },
        {
          widthMm: 80,
          heightMm: 55,
          meta: { title: "背面" },
          components: [
            {
              kind: "text",
              leftMm: 0,
              topMm: 0,
              widthMm: 20,
              heightMm: 5,
              text: "Back",
            },
          ],
        },
      ],
    },
  });
}
function table(): ReportTemplateDocument {
  const document = defineReportTemplate({
    id: "table",
    name: "Table",
    template: createTableTemplate({
      columns: [
        { field: "qty", header: "数量", widthMm: 40 },
        { field: "total", header: "合计", widthMm: 40 },
      ],
    }),
  });
  (document.template.pages[0]!.components[0] as ListComponent).computed = [
    { field: "total", expression: { field: "qty" } },
  ];
  return document;
}
async function run(wrapper: ReturnType<typeof mount>) {
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "运行检查")!
    .trigger("click");
  await vi.waitFor(
    () => expect(wrapper.attributes("aria-busy")).toBe("false"),
    { timeout: 1000, interval: 5 },
  );
  await flushPromises();
}

describe("versioned report fragments and content styles", () => {
  it("merges source fields when several fragment lists share a dataset", () => {
    const document = table(),
      second = JSON.parse(
        JSON.stringify(document.template.pages[0]!.components[0]),
      ) as ListComponent;
    second.columns = [{ field: "price", header: "单价", widthMm: 80 }];
    delete second.computed;
    second.topMm += 30;
    document.template.pages[0]!.components.push(second);
    const fragment = captureTemplateFragment(document, 0, [0, 1], {
      id: "two-lists",
      name: "两张业务表",
      revision: "1",
    });
    expect(inspectTemplateFragmentBindings(fragment)).toEqual([
      { dataset: "detail", fields: ["qty", "price"] },
    ]);
    const inserted = insertTemplateFragment(document, fragment, {
      pageIndex: 0,
      bindings: { fields: { detail: { qty: "weight", price: "unit_price" } } },
    });
    const lists = inserted.componentIndices.map(
      (index) =>
        inserted.document.template.pages[0]!.components[index] as ListComponent,
    );
    expect(lists.map((list) => list.columns[0]!.field)).toEqual([
      "weight",
      "unit_price",
    ]);
  });
  it("captures normalized copies, rebinds label fields and strips source identities without mutating publication inputs", () => {
    const original = label(),
      before = JSON.stringify(original);
    const fragment = captureTemplateFragment(original, 0, [0], {
      id: "brand",
      name: "品牌区",
      revision: "1",
    });
    expect(fragment.components[0]).toMatchObject({ leftMm: 0, topMm: 0 });
    expect(inspectTemplateFragmentBindings(fragment)).toEqual([
      { dataset: "records", fields: ["serial"] },
    ]);
    const inserted = insertTemplateFragment(original, fragment, {
      pageIndex: 0,
      leftMm: 3,
      topMm: 18,
      bindings: { fields: { records: { serial: "material_id" } } },
    });
    const component = inserted.document.template.pages[0]!.components[1]!;
    expect(component).toMatchObject({
      leftMm: 3,
      topMm: 18,
      binding: { field: "material_id" },
      meta: { fragment: { id: "brand", revision: "1" } },
    });
    expect(component).not.toHaveProperty("nid");
    expect(component).not.toHaveProperty("rkey");
    expect(component.meta).not.toHaveProperty("labelSource");
    expect(JSON.stringify(original)).toBe(before);
    expect(inserted.document.revision).toBe("4");
    fragment.components[0]!.widthMm = 12;
    expect(component.widthMm).toBe(45);
  });
  it("upgrades an explicit instance atomically and never upgrades existing copies implicitly", () => {
    const fragment = captureTemplateFragment(label(), 0, [0], {
      id: "brand",
      name: "品牌区",
      revision: "1",
    });
    const first = insertTemplateFragment(label(), fragment, {
      pageIndex: 0,
      topMm: 18,
    });
    const second = insertTemplateFragment(first.document, fragment, {
      pageIndex: 0,
      topMm: 30,
    });
    const next = {
      ...fragment,
      revision: "2",
      components: fragment.components.map((component) => ({
        ...component,
        text: "Updated",
      })),
    };
    const upgraded = insertTemplateFragment(second.document, next, {
      pageIndex: 0,
      replaceInstance: first.instance,
    });
    expect(upgraded.document.template.pages[0]!.components).toHaveLength(3);
    expect(
      upgraded.document.template.pages[0]!.components[1]!.meta?.fragment,
    ).toMatchObject({ revision: "2", instance: first.instance });
    expect(
      upgraded.document.template.pages[0]!.components[2]!.meta?.fragment,
    ).toMatchObject({ revision: "1", instance: second.instance });
    expect(
      second.document.template.pages[0]!.components[1]!.meta?.fragment,
    ).toMatchObject({ revision: "1" });
    expect(() =>
      insertTemplateFragment(
        second.document,
        { ...next, id: "another" },
        { pageIndex: 0, replaceInstance: first.instance },
      ),
    ).toThrow(/same fragment/);
    expect(() =>
      insertTemplateFragment(second.document, next, {
        pageIndex: 0,
        replaceInstance: "missing",
      }),
    ).toThrow(/no longer exists/);
  });
  it("rebinds displayed, calculated and row identity fields together, retaining derived field names", () => {
    const fragment = captureTemplateFragment(table(), 0, [0], {
      id: "summary",
      name: "汇总",
      revision: "1",
    });
    const result = insertTemplateFragment(table(), fragment, {
      pageIndex: 0,
      bindings: {
        datasets: { detail: "items" },
        fields: { detail: { qty: "weight" } },
      },
    });
    const list = result.document.template.pages[0]!.components.at(
      -1,
    ) as ListComponent;
    expect(list.dataset).toBe("items");
    expect(list.columns[0]!.field).toBe("weight");
    expect(list.columns[1]!.field).toBe("total");
    expect(list.computed![0]!.expression).toEqual({ field: "weight" });
  });
  it("rejects incompatible record datasets and overflowing geometry before any mutation", () => {
    const document = label(),
      before = JSON.stringify(document),
      fragment = captureTemplateFragment(document, 0, [0], {
        id: "brand",
        name: "品牌",
        revision: "1",
      });
    expect(() =>
      insertTemplateFragment(document, fragment, { pageIndex: 0, leftMm: 60 }),
    ).toThrow(/exceeds/);
    expect(() =>
      insertTemplateFragment(
        document,
        { ...fragment, repeatDataset: "other" },
        { pageIndex: 0 },
      ),
    ).toThrow(/record dataset/);
    expect(JSON.stringify(document)).toBe(before);
  });
  it("applies actual content/header roles over explicit column overrides while retaining data and layout", () => {
    const original = table(),
      list = original.template.pages[0]!.components[0] as ListComponent;
    list.columns[0]!.align = "left";
    list.columns[0]!.headerStyle = { color: "#ff0000", align: "left" };
    const numeric = applyReportDocumentStyle(original, 0, [0], {
      id: "num",
      name: "Numeric",
      style: { align: "right", fontSize: 11 },
    });
    const header = applyReportDocumentStyle(numeric, 0, [0], {
      id: "head",
      name: "Header",
      target: "header",
      style: { align: "center", color: "#123456" },
    });
    expect(
      (header.template.pages[0]!.components[0] as ListComponent).columns[0],
    ).toMatchObject({
      field: "qty",
      align: "right",
      headerAlign: "center",
      headerStyle: { color: "#123456", align: "center" },
    });
    expect(list.columns[0]!.align).toBe("left");
    const pixels = label();
    (pixels.template.pages[0]!.components[0] as { style: object }).style = {
      fontSizePx: 24,
    };
    const points = applyReportDocumentStyle(pixels, 0, [0], {
      id: "body",
      name: "Body",
      style: { fontSize: 10 },
    });
    expect(points.template.pages[0]!.components[0]).toHaveProperty(
      "style.fontSize",
      10,
    );
    expect(points.template.pages[0]!.components[0]).not.toHaveProperty(
      "style.fontSizePx",
    );
  });
});

describe("outline, usage and field change safeguards", () => {
  it("indexes named faces, displayed fields, calculations and formula references", () => {
    const outline = collectTemplateOutline(table().template);
    expect(
      outline.some(
        (entry) => entry.kind === "calculation" && entry.field === "total",
      ),
    ).toBe(true);
    const usage = inspectTemplateFieldUsage(table().template, "detail", "qty");
    expect(usage.map((item) => item.kind)).toEqual(["display", "calculation"]);
    expect(usage[1]).toMatchObject({ pageIndex: 0, componentIndex: 0 });
  });
  it("shows search and locates a cross-page binding with its physical position", async () => {
    const wrapper = mount(TemplateOutlinePanel, {
      props: { document: label() },
    });
    await wrapper.get('input[type="search"]').setValue("背面");
    expect(wrapper.findAll(".mr-outline-tree button")).toHaveLength(1);
    await wrapper.get(".mr-outline-tree button").trigger("click");
    expect(wrapper.emitted("locate")![0]![0]).toMatchObject({
      pageIndex: 1,
      kind: "page",
    });
    await wrapper.get('input[type="search"]').setValue("serial");
    await wrapper.findAll(".mr-outline-tree button").at(-1)!.trigger("click");
    expect(wrapper.get("aside").text()).toContain("serial");
    wrapper.unmount();
  });
  it("holds a mapped field change until its formula usage is explicitly acknowledged", () => {
    const document = ref(table()),
      changed = vi.fn();
    const columns = useTemplateColumns(
      document,
      () => true,
      () => true,
      changed,
    );
    columns.setColumn(0, "field", "weight");
    expect(columns.activeList.value!.columns[0]!.field).toBe("qty");
    expect(columns.fieldChange.value?.references[0]).toMatchObject({
      kind: "calculation",
    });
    expect(changed).not.toHaveBeenCalled();
    columns.cancelFieldChange();
    expect(columns.activeList.value!.columns[0]!.field).toBe("qty");
    columns.setColumn(0, "field", "weight");
    columns.confirmFieldChange();
    expect(columns.activeList.value!.columns[0]!.field).toBe("weight");
    expect(columns.activeList.value!.computed![0]!.expression).toEqual({
      field: "qty",
    });
    expect(changed).toHaveBeenCalledOnce();
  });
  it("renders reusable fragment insertion and content styles as actual validated editor transactions", async () => {
    const document = ref(label()),
      fragment = captureTemplateFragment(document.value, 0, [0], {
        id: "brand",
        name: "Brand",
        revision: "1",
      });
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(TemplateReusePanel, {
            document: document.value,
            pageIndex: 0,
            selection: { pageIndex: 0, componentIndex: 0 },
            fragments: [fragment],
            accept: (change: (document: ReportTemplateDocument) => void) => {
              const copy = JSON.parse(
                JSON.stringify(document.value),
              ) as ReportTemplateDocument;
              change(copy);
              document.value = copy;
              return true;
            },
          }),
      }),
    );
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "插入独立副本")!
      .trigger("click");
    expect(document.value.template.pages[0]!.components).toHaveLength(2);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "应用到当前组件")!
      .trigger("click");
    expect(document.value.template.pages[0]!.components[0]).toHaveProperty(
      "style.color",
      "#334155",
    );
    wrapper.unmount();
  });
});

describe("named fixture acceptance and bounded comparison", () => {
  it("cancels a cooperative review without replacing the previous results", async () => {
    const wrapper = mount(TemplateReviewPanel, {
      props: {
        document: table(),
        fixtures: [{ name: "old", datasets: { detail: [{ qty: 0 }] } }],
      },
      global: { stubs: { ReportPreview: true } },
    });
    await run(wrapper);
    expect(wrapper.get(".mr-review-sample").text()).toContain("old");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "运行检查")!
      .trigger("click");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "取消检查")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.attributes("aria-busy")).toBe("false");
    expect(wrapper.get(".mr-review-sample").text()).toContain("old");
    expect(wrapper.text()).toContain("本次检查已取消");
    wrapper.unmount();
  });
  it("checks explicit named scenarios and compares the exact same data on both sides", async () => {
    const current = table(),
      previous = table();
    previous.template.pages[0]!.widthMm += 10;
    const fixture = { name: "真实零值", datasets: { detail: [{ qty: 0 }] } };
    const wrapper = mount(TemplateReviewPanel, {
      props: {
        document: current,
        previous,
        fixtures: [fixture],
        formats: ["pdf"],
      },
      global: { stubs: { ReportPreview: true } },
    });
    await run(wrapper);
    expect(wrapper.get(".mr-review-sample").text()).toContain("真实零值");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "对比基线与草稿")!
      .trigger("click");
    expect(wrapper.get(".mr-fixture-comparison").text()).toContain("页面尺寸");
    const comparison = compareTemplateFixture(current, fixture, previous);
    const plan = await comparison.current.fetcher({
      reportIds: ["draft"],
      params: {},
    });
    expect(plan.pages.length).toBeGreaterThan(0);
    expect(comparison.current.dimensions).not.toEqual(
      comparison.previous!.dimensions,
    );
    await wrapper.setProps({ document: { ...current, name: "Changed" } });
    expect(wrapper.find(".mr-fixture-comparison").exists()).toBe(false);
    wrapper.unmount();
  });
  it("captures a named de-identified sample only after explicit consent and keeps it out of the template", async () => {
    const document = table(),
      before = JSON.stringify(document),
      datasets = { detail: [{ qty: 0 }] };
    const wrapper = mount(TemplateReviewPanel, {
      props: { document, datasets },
      global: { stubs: { ReportPreview: true } },
    });
    await wrapper
      .get('.mr-review-fixture-form input:not([type="checkbox"])')
      .setValue("空与零值");
    const button = wrapper
      .findAll("button")
      .find((item) => item.text() === "保存当前数据为样例")!;
    expect(button.attributes("disabled")).toBeDefined();
    await wrapper.get(".mr-review-consent input").setValue(true);
    await button.trigger("click");
    datasets.detail[0]!.qty = 9;
    await run(wrapper);
    expect(wrapper.get(".mr-review-sample").text()).toContain("空与零值");
    expect(JSON.stringify(document)).toBe(before);
    wrapper.unmount();
  });
  it("does not invoke getters, accepts zero, and rejects cycles/non-finite values during capture", () => {
    const getter = vi.fn(() => 1),
      data = {
        rows: [
          Object.defineProperty({}, "qty", { get: getter, enumerable: true }),
        ],
      };
    expect(() => snapshotFixtureData(data)).toThrow(/getters/);
    expect(getter).not.toHaveBeenCalled();
    expect(snapshotFixtureData({ rows: [{ value: 0 }] }).rows![0]!.value).toBe(
      0,
    );
    expect(() => snapshotFixtureData({ rows: [{ value: NaN }] })).toThrow(
      /JSON/,
    );
    const row: Record<string, unknown> = {};
    row.self = row;
    expect(() => snapshotFixtureData({ rows: [row] })).toThrow(/cycles/);
  });
});
