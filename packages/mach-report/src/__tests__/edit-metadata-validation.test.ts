// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTableTemplate } from "../builder/table-template";
import { validateRenderPlan } from "../schema/validate";
import { defineReportTemplate, parseReportTemplate, serializeReportTemplate, validateReportTemplate } from "../source/template-registry";
import type { ListComponent, ReportTemplate } from "../layout/paginate";

function staticTemplate(cell: Record<string, unknown>): ReportTemplate {
  return { pages: [{ widthMm: 210, heightMm: 297, components: [{
    kind: "rect", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 20,
    grid: { cells: [[cell]] }
  }] }] };
}

describe("editing metadata validation at JSON and runtime boundaries", () => {
  it.each([
    ["editable", "false"], ["editable", 0], ["editable", null],
    ["valueType", "date"], ["valueType", 1], ["valueType", null],
    ["formula", 123], ["formula", false], ["formula", {}]
  ])("rejects malformed static cell %s=%j in templates and runtime plans", (key, value) => {
    const template = staticTemplate({ text: "value", [key as string]: value });
    const component = template.pages[0]!.components[0];
    const runtime = { pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [component] }] };
    const path = `$.pages.0.components.0.grid.cells.0.0.${key}`;
    const templateResult = validateReportTemplate(template);
    const runtimeResult = validateRenderPlan(runtime);
    expect(templateResult.ok).toBe(false);
    expect(runtimeResult.ok).toBe(false);
    expect(templateResult.errors.filter((error) => error.path === path)).toHaveLength(1);
    expect(runtimeResult.errors.filter((error) => error.path === path)).toHaveLength(1);
  });

  it.each([
    ["editable", "true"], ["editable", null], ["valueType", "date"], ["valueType", false]
  ])("rejects malformed list column %s=%j before template storage", (key, value) => {
    const template = createTableTemplate({ columns: [{ header: "值", field: "value" }] });
    const list = template.pages[0]!.components[0] as ListComponent;
    Object.assign(list.columns[0]!, { [key as string]: value });
    const result = validateReportTemplate(template);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ path: `$.pages.0.components.0.columns.0.${key}` }));
    expect(() => defineReportTemplate({ id: "bad", name: "bad", template })).toThrow();
  });

  it("serializes valid static and list editing metadata without losing false or formula strings", () => {
    const template = createTableTemplate({ columns: [
      { header: "编号", field: "id", editable: false, valueType: "text" },
      { header: "数量", field: "qty", editable: true, valueType: "number" },
      { header: "启用", field: "enabled", valueType: "boolean" }
    ] });
    template.pages[0]!.components.push(...staticTemplate({ text: "cached", value: 0, editable: false, valueType: "number", formula: "A1+B1" }).pages[0]!.components);
    const document = defineReportTemplate({ id: "valid", name: "valid", template });
    const parsed = parseReportTemplate(serializeReportTemplate(document));
    expect(parsed).toEqual(document);
    expect(validateReportTemplate(parsed.template).ok).toBe(true);
  });

  it("validates nested cell metadata with the full nested path", () => {
    const child = staticTemplate({ text: "value", editable: "false" }).pages[0]!.components[0]!;
    const template = staticTemplate({ text: "parent", children: [child] });
    const result = validateReportTemplate(template);
    expect(result.errors).toContainEqual(expect.objectContaining({ path: "$.pages.0.components.0.grid.cells.0.0.children.0.grid.cells.0.0.editable" }));
  });
});
