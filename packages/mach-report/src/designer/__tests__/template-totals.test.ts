import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import {
  createReportSource,
  type ListComponent,
} from "@agile-team/mach-report";
import TemplateTotalsEditor from "../TemplateTotalsEditor.vue";

function list(): ListComponent {
  return {
    kind: "list",
    dataset: "detail",
    leftMm: 5,
    topMm: 5,
    widthMm: 120,
    columns: [
      { field: "name", header: "项目", widthMm: 40 },
      { field: "amount", header: "重量", widthMm: 40, valueType: "number" },
      {
        field: "id",
        header: "编号",
        widthMm: 40,
        valueType: "number",
        semanticRole: "identifier",
      },
    ],
  };
}
describe("simple totals through the shared list summary engine", () => {
  it.each([
    ["sum", 6],
    ["avg", 2],
    ["count", 3],
  ])(
    "adds a %s total in one action and produces its real value without changing data",
    async (op, expected) => {
      const original = list(),
        before = structuredClone(original),
        rows = [
          { name: "甲", amount: 0 },
          { name: "乙", amount: 2 },
          { name: "丙", amount: 4 },
          { name: "丁", amount: null },
        ];
      const wrapper = mount(TemplateTotalsEditor, {
        props: { list: original },
      });
      expect(wrapper.get("details").attributes("open")).toBeUndefined();
      expect(wrapper.get("summary").text()).toContain("未设置");
      expect(wrapper.get("summary").text()).toContain("添加汇总");
      const fields = wrapper.get('select[aria-label="汇总字段"]');
      expect(fields.findAll("option").map((item) => item.text())).toEqual([
        "重量",
      ]);
      await wrapper.get('select[aria-label="计算方式"]').setValue(op);
      await wrapper.get(".mr-totals-add").trigger("click");
      const candidate = wrapper.emitted("change")![0]![0] as ListComponent;
      expect(candidate.grandTotal).toMatchObject({
        aggregates: [{ field: "amount", op }],
      });
      expect(original).toEqual(before);
      const fetch = createReportSource({
        summary: {
          template: {
            pages: [{ widthMm: 140, heightMm: 150, components: [candidate] }],
          },
          datasets: { detail: rows },
        },
      });
      const plan = await fetch({ reportIds: ["summary"], params: {} });
      const totals = plan.pages
        .flatMap((page) => page.components)
        .filter((component) => component.table?.role === "grand-total");
      expect(
        totals
          .flatMap((component) => component.grid!.cells.flat())
          .some((cell) => cell?.value === expected),
      ).toBe(true);
      expect(rows[0]!.amount).toBe(0);
      wrapper.unmount();
    },
  );
  it("retains inherited totals, unknown weighted configurations and styling when adding or removing a known field", async () => {
    const original = list();
    original.groupBy = {
      field: "name",
      subtotal: ["id"],
      aggregates: [
        {
          field: "id",
          op: "weightedAvg",
          valueField: "amount",
          weightField: "amount",
          numeric: "decimal",
          digits: 4,
        },
      ],
    };
    original.grandTotal = { label: "原有总计", style: { color: "#234567" } };
    const wrapper = mount(TemplateTotalsEditor, { props: { list: original } });
    await wrapper.get(".mr-totals-add").trigger("click");
    const candidate = wrapper.emitted("change")![0]![0] as ListComponent;
    expect(candidate.grandTotal).toMatchObject({
      label: "原有总计",
      style: { color: "#234567" },
      fields: ["id"],
      aggregates: [
        original.groupBy.aggregates![0],
        { field: "amount", op: "sum" },
      ],
    });
    await wrapper.setProps({ list: candidate });
    expect(wrapper.text()).toContain("高级配置");
    expect(wrapper.findAll('button[aria-label="移除汇总 编号"]')).toHaveLength(
      0,
    );
    await wrapper.get('button[aria-label="移除汇总 重量"]').trigger("click");
    const removed = wrapper.emitted("change")!.at(-1)![0] as ListComponent;
    expect(removed.grandTotal).toMatchObject({
      label: "原有总计",
      style: { color: "#234567" },
      aggregates: original.groupBy.aggregates,
    });
    expect(original.grandTotal).toEqual({
      label: "原有总计",
      style: { color: "#234567" },
    });
    wrapper.unmount();
  });
  it("targets the existing group level and preserves all other layout properties", async () => {
    const original = list();
    original.groups = [
      { field: "name", subtotalLabel: "组计", headerStyle: { bold: true } },
    ];
    const wrapper = mount(TemplateTotalsEditor, { props: { list: original } });
    await wrapper.get('select[aria-label="显示位置"]').setValue("group-0");
    await wrapper.get('select[aria-label="计算方式"]').setValue("avg");
    await wrapper.get(".mr-totals-add").trigger("click");
    const candidate = wrapper.emitted("change")![0]![0] as ListComponent;
    expect(candidate.groups![0]).toMatchObject({
      field: "name",
      subtotalLabel: "组计",
      headerStyle: { bold: true },
      aggregates: [{ field: "amount", op: "avg" }],
    });
    expect(candidate.grandTotal).toBeUndefined();
    expect(wrapper.text()).toContain("每个分组");
    wrapper.unmount();
  });
  it("keeps explicit complex configurations and readonly documents untouched", async () => {
    const original = list();
    original.grandTotal = {
      aggregates: [{ field: "amount", op: "weightedAvg", weightField: "id" }],
    };
    const wrapper = mount(TemplateTotalsEditor, { props: { list: original } });
    expect(wrapper.get(".mr-totals-add").attributes("disabled")).toBeDefined();
    await wrapper.get(".mr-totals-add").trigger("click");
    expect(wrapper.emitted("change")).toBeUndefined();
    await wrapper.setProps({ list: list(), readonly: true });
    expect(wrapper.get(".mr-totals-add").attributes("disabled")).toBeDefined();
    await wrapper.setProps({
      readonly: false,
      list: { ...list(), cardinality: "record" },
    });
    expect(wrapper.find(".mr-totals-add").exists()).toBe(false);
    expect(wrapper.text()).toContain("单记录布局");
    wrapper.unmount();
  });
  it("uses decimal contracts for exact totals without coercing large business values or applying display rounding", async () => {
    const original = list();
    original.columns[1]!.format = { kind: "number", digits: 2 };
    const wrapper = mount(TemplateTotalsEditor, { props: {
      list: original,
      schema: { fields: [{ field: "amount", type: "decimal", semanticRole: "measure", format: { kind: "number", digits: 2 } }] },
    } });
    await wrapper.get(".mr-totals-add").trigger("click");
    const candidate = wrapper.emitted("change")![0]![0] as ListComponent;
    expect(candidate.grandTotal).toMatchObject({ aggregates: [{ field: "amount", op: "sum", numeric: "decimal" }] });
    const rows = [{ amount: "9007199254740993.123456789" }, { amount: "0.876543211" }];
    const fetch = createReportSource({ exact: {
      template: { pages: [{ widthMm: 140, heightMm: 150, components: [candidate] }] },
      datasets: { detail: rows },
    } });
    const plan = await fetch({ reportIds: ["exact"], params: {} });
    const total = plan.pages.flatMap(page => page.components)
      .filter(component => component.table?.role === "grand-total")
      .flatMap(component => component.grid!.cells.flat())
      .find(cell => cell?.value === "9007199254740994");
    expect(total).toBeDefined();
    expect(rows[0]!.amount).toBe("9007199254740993.123456789");
    wrapper.unmount();
  });
  it("follows declared field types and excludes non-additive measures despite stale numeric column metadata", () => {
    const original = list();
    original.columns.push({ field: "ratio", header: "比例", widthMm: 20, valueType: "number" });
    const wrapper = mount(TemplateTotalsEditor, { props: {
      list: original,
      schema: { fields: [
        { field: "amount", type: "text" },
        { field: "id", type: "date" },
        { field: "ratio", type: "number", aggregation: "none" },
      ] },
    } });
    expect(wrapper.get('select[aria-label="汇总字段"]').findAll("option")).toHaveLength(0);
    expect(wrapper.get(".mr-totals-add").attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });
  it("inherits computed decimal output and preserves explicitly configured precision on updates", async () => {
    const original = list();
    original.computed = [{ field: "amount", numeric: "decimal", expression: { field: "raw" } }];
    const wrapper = mount(TemplateTotalsEditor, { props: { list: original } });
    await wrapper.get(".mr-totals-add").trigger("click");
    const candidate = wrapper.emitted("change")![0]![0] as ListComponent;
    expect(candidate.grandTotal).toMatchObject({ aggregates: [{ field: "amount", numeric: "decimal" }] });
    candidate.grandTotal = { aggregates: [{ field: "amount", op: "sum", numeric: "decimal", digits: 6 }] };
    await wrapper.setProps({ list: candidate });
    await wrapper.get('select[aria-label="计算方式"]').setValue("avg");
    await wrapper.get(".mr-totals-add").trigger("click");
    const updated = wrapper.emitted("change")!.at(-1)![0] as ListComponent;
    expect(updated.grandTotal).toMatchObject({ aggregates: [{ field: "amount", op: "avg", numeric: "decimal", digits: 6 }] });
    expect(original.grandTotal).toBeUndefined();
    wrapper.unmount();
  });

  it("excludes numeric business row keys even when their semantic role was omitted", () => {
    const original = list();
    delete original.columns[2]!.semanticRole;
    const wrapper = mount(TemplateTotalsEditor, { props: {
      list: original,
      schema: { rowKey: "id", fields: [{ field: "id", type: "number" }] },
    } });
    expect(wrapper.get('select[aria-label="汇总字段"]').findAll("option").map(option => option.text())).toEqual(["重量"]);
    wrapper.unmount();
  });

});
