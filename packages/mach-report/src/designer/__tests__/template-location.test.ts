// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTableTemplate, defineReportTemplate } from "../../index";
import { resolveDesignerLocation } from "../template-location";

function document() {
  const template = createTableTemplate({ columns: [{ field: "heat", header: "炉号" }, { field: 'energy"x', header: "用电量" }] });
  template.params = [{ field: "plant", type: "text" }];
  template.pages.push({ widthMm: 100, heightMm: 200, components: [{ kind: "text", nid: "tail", text: "说明", leftMm: 1, topMm: 1, widthMm: 30, heightMm: 10 }] });
  const list = template.pages[0]!.components.find(component => component.kind === "list")!;
  list.computed = [{ field: "total", expression: { field: "energy" } }];
  list.groups = [{ field: "heat" }];
  list.columns[1]!.rules = [{ when: { field: "energy", op: ">", value: 0 }, style: { bold: true } }];
  return defineReportTemplate({ id: "daily", name: "日报", template });
}
describe("precise designer path routing", () => {
  it.each([
    ["$.template.pages[1].widthMm", { section: "template", pageIndex: 1, control: "page-widthMm" }],
    ['$.template.params["plant"].type', { section: "tools", tool: "params", paramField: "plant", control: "type" }],
    ['$.template.pages[0].components[0].columns["energy\\"x"].header', { section: "fields", columnIndex: 1, field: 'energy"x', control: "column-header" }],
    ["$.template.pages[0].components[0].computed[0].expression.field", { section: "tools", tool: "rules", rule: { tab: "computations", field: "total" } }],
    ["$.template.pages[0].components[0].groups[0].field", { section: "tools", tool: "rules", rule: { tab: "groups", index: 0 } }],
    ["$.template.pages[0].components[0].columns[1].rules[0].when.field", { section: "tools", tool: "rules", rule: { tab: "conditions", field: 'energy"x', index: 0, effect: "style" } }],
    ["$.template.pages[0].components[0].matrix.rowFields[0]", { section: "tools", tool: "rules", rule: { tab: "matrix" } }],
    ["$.template.pages[0].components[0].grandTotal.aggregates[0].field", { section: "fields", control: "list-totals" }],
    ["$.name", { section: "template", control: "document-name" }],
  ])("routes %s to an existing editor destination", (path, target) => {
    expect(resolveDesignerLocation(document(), { path }).target).toMatchObject(target);
  });
  it("distinguishes deleted, externally owned and unsupported items", () => {
    expect(resolveDesignerLocation(document(), { path: "$.template.pages[1]" }, true)).toEqual({ reason: "removed" });
    expect(resolveDesignerLocation(document(), { path: '$.template.params["deleted"]' })).toEqual({ reason: "removed" });
    expect(resolveDesignerLocation(document(), { path: "$.template.pages[8].widthMm" })).toEqual({ reason: "removed" });
    expect(resolveDesignerLocation(document(), { path: "$.datasets.detail" })).toEqual({ reason: "external" });
    expect(resolveDesignerLocation(document(), { path: "$.template" })).toEqual({ reason: "unavailable" });
  });
  it("retains physical column identity while a field name is invalid", () => {
    const value = document();
    const list = value.template.pages[0]!.components[0]!;
    if (list.kind !== "list") throw new Error("Fixture must contain a list");
    list.columns[1]!.field = "";
    expect(resolveDesignerLocation(value, { path: "$.template.pages[0].components[0].columns[1].field" }).target).toMatchObject({ section: "fields", columnIndex: 1, field: "" });
  });
  it("does not offer navigation into a capability disabled by the project", () => {
    expect(resolveDesignerLocation(document(), { path: '$.template.params["plant"].type' }, false, { params: false })).toEqual({ reason: "unavailable" });
    expect(resolveDesignerLocation(document(), { path: "$.template.pages[0].components[0].matrix.rowFields[0]", field: "source-only" }).target).toMatchObject({ tool: "rules", rule: { tab: "matrix" } });
  });
});
