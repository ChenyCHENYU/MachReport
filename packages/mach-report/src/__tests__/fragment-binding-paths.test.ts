// @vitest-environment node
import { describe, expect, it } from "vitest";
import { defineReportTemplate } from "../source/template-registry";
import { captureTemplateFragment, insertTemplateFragment } from "../source/template-fragments";
import { collectTemplateDatasetBindings } from "../source/template-bindings";
import { paginateTemplate, type ListComponent, type ReportTemplate } from "../layout/paginate";

function document(list: Partial<ListComponent>) {
  return defineReportTemplate({ id: "grouped", name: "Grouped", template: { pages: [{ widthMm: 120, heightMm: 120, components: [{
    kind: "list", dataset: "rows", leftMm: 0, topMm: 0, widthMm: 100, rowHeightMm: 6,
    columns: [{ field: "plant", header: "Plant", widthMm: 50 }, { field: "amount", header: "Amount", widthMm: 50 }],
    ...list
  }] }] } });
}
function rebind(list: Partial<ListComponent>) {
  const original = document(list);
  const fragment = captureTemplateFragment(original, 0, [0], { id: "summary", name: "Summary", revision: "1" });
  const empty = document(list); empty.template.pages[0]!.components = [];
  return insertTemplateFragment(empty, fragment, { pageIndex: 0, bindings: { datasets: { rows: "items" }, fields: { rows: { plant: "factory", amount: "net" } } } }).document;
}
function totals(template: ReportTemplate) {
  return paginateTemplate(template, { items: [{ factory: "A", net: 10 }, { factory: "A", net: 20 }] }).plan.pages
    .flatMap(page => page.components.filter(component => component.table?.role === "subtotal" || component.table?.role === "grand-total"))
    .flatMap(component => component.grid!.cells.flat().map(cell => cell?.text));
}
describe("fragment source bindings use actual template property paths", () => {
  it("rebinds legacy groupBy fields and subtotal arrays without inventing a groups property", () => {
    const result = rebind({ groupBy: { field: "plant", subtotal: ["amount"] }, grandTotal: true });
    const list = result.template.pages[0]!.components[0] as ListComponent;
    expect(list.groupBy).toMatchObject({ field: "factory", subtotal: ["net"] });
    expect(list.groups).toBeUndefined(); expect(totals(result.template).filter(text => text === "30")).toHaveLength(2);
    const bindings = collectTemplateDatasetBindings(result.template);
    expect(bindings[0]!.fields.some(reference => reference.path.endsWith(".groupBy.field"))).toBe(true);
  });
  it.each([undefined, "amount"])("rebinds same-field aggregate input/output together (valueField=%s)", valueField => {
    const aggregate = { field: "amount", op: "sum" as const, ...(valueField ? { valueField } : {}) };
    const result = rebind({ groups: [{ field: "plant", aggregates: [aggregate] }], grandTotal: { aggregates: [aggregate] } });
    const list = result.template.pages[0]!.components[0] as ListComponent;
    expect(list.groups![0]!.aggregates![0]!.field).toBe("net");
    expect((list.grandTotal as { aggregates: Array<{ field: string }> }).aggregates[0]!.field).toBe("net");
    expect(totals(result.template).filter(text => text === "30")).toHaveLength(2);
  });
  it("preserves distinct aggregate output aliases while changing their real source field", () => {
    const result = rebind({
      columns: [{ field: "plant", header: "Plant", widthMm: 50 }, { field: "total", header: "Total", widthMm: 50 }],
      groupBy: { field: "plant", aggregates: [{ field: "total", valueField: "amount", op: "sum" }] }
    });
    const list = result.template.pages[0]!.components[0] as ListComponent;
    expect(list.groupBy!.aggregates![0]).toMatchObject({ field: "total", valueField: "net" });
    expect(totals(result.template)).toContain("30");
  });
});
