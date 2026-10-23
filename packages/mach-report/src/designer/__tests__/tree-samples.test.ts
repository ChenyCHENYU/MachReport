import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { designListSamples } from "../tree-samples";
import TemplateReviewPanel from "../TemplateReviewPanel.vue";
import { paginateTemplate, type ListComponent } from "../../layout/paginate";
const list = (): ListComponent => ({ kind: "list", dataset: "cost", leftMm: 0, topMm: 0, widthMm: 100, columns: [{ field: "name", header: "Item", widthMm: 60 }, { field: "amount", header: "Amount", widthMm: 40 }], tree: { input: "flat", idField: "id", parentField: "parent", labelField: "name", parentValues: "leaf-aggregate", aggregates: [{ field: "amount", op: "sum", numeric: "decimal", digits: 2 }] } });
describe("complete bounded tree samples", () => {
  it("uses the same calculated amounts, edit protection and indentation as actual output", () => {
    const component = list(), rows = [{ id: "L", parent: "P", name: "Leaf", amount: "0.10" }, { id: "P", parent: null, name: "Parent", amount: "999" }];
    const samples = designListSamples(component, rows);
    const plan = paginateTemplate({ pages: [{ widthMm: 100, heightMm: 297, components: [component] }] }, { cost: rows }).plan;
    expect(samples).toEqual(plan.pages[0]!.components.filter(item => item.table?.role === "body").map(item => item.grid!.cells[0]));
    expect(samples[0]![1]!.value).toBe("0.10"); expect(samples[1]![0]!.indentMm).toBe(3);
    expect(designListSamples(component, rows, 1)).toEqual([samples[0]]);
  });
  it("does not substitute unchecked raw parent values when graph or sample budgets fail", () => {
    const component = list();
    expect(designListSamples(component, [{ id: "P", parent: "missing", amount: 999 }])).toEqual([]);
    expect(designListSamples(component, Array.from({ length: 201 }, (_, id) => ({ id, name: String(id), amount: 0 })))).toEqual([]);
  });
  it("does not truncate flat relations into fake orphan errors during review", async () => {
    const component = list(), rows = Array.from({ length: 25 }, (_, index) => ({ id: String(index), parent: index === 24 ? null : "24", name: `Node ${index}`, amount: "0.10" }));
    const wrapper = mount(TemplateReviewPanel, { props: { document: { schemaVersion: "1.0", id: "cost", name: "Cost", template: { pages: [{ widthMm: 100, heightMm: 297, components: [component] }] } }, datasets: { cost: rows }, formats: ["xlsx"] } });
    await wrapper.get("header button").trigger("click");
    await vi.waitFor(() => expect(wrapper.attributes("aria-busy")).toBe("false"), { timeout: 1000, interval: 5 });
    expect(wrapper.text()).toContain("25 行超过预算 20"); expect(wrapper.text()).not.toContain("父节点不存在");
    await wrapper.get("select").setValue("-1"); await wrapper.get("header button").trigger("click");
    await vi.waitFor(() => expect(wrapper.attributes("aria-busy")).toBe("false"), { timeout: 1000, interval: 5 });
    expect(wrapper.get(".mr-review-scope").text()).toContain("25 行"); expect(wrapper.text()).not.toContain("父节点不存在"); wrapper.unmount();
  });
});
