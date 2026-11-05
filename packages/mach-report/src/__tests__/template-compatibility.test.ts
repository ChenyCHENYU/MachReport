// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTableTemplate } from "../builder/table-template";
import { inspectReportTemplateCompatibility, type ReportTemplateDataContract } from "../source/template-compatibility";
import { bindReportTemplateContext } from "../source/template-context";
import { defineReportTemplate, parseReportTemplate, serializeReportTemplate, validateReportTemplate } from "../source/template-registry";

function contract(source = "eaf"): ReportTemplateDataContract {
  return { source, datasets: { detail: { fields: [
    { field: "id", label: "炉号", semanticKey: "heat-number", type: "text" },
    { field: "c_C", label: "班别", semanticKey: "shift-team" },
    { field: "weight", label: "重量", semanticKey: "tap-weight", type: "number", unit: "kg" }
  ] } } };
}
function template() {
  const value = createTableTemplate({ columns: [{ field: "id", header: "炉号" }, { field: "c_C", header: "班别" }, { field: "weight", header: "重量" }] });
  value.dataContract = contract();
  return value;
}

describe("stored template business compatibility", () => {
  it("round-trips provenance and accepts geometry/caption edits with unchanged meanings", () => {
    const value = template();
    const list = value.pages[0]!.components.find(item => item.kind === "list")!;
    if (list.kind !== "list") throw new Error("fixture");
    list.leftMm = 20;
    list.columns[1]!.header = "自定义班别名称";
    const document = defineReportTemplate({ id: "source", name: "Layout", template: value });
    const restored = parseReportTemplate(serializeReportTemplate(document));
    expect(restored.template.dataContract).toEqual(contract());
    expect(inspectReportTemplateCompatibility(restored.template, contract())).toEqual({ ok: true, issues: [] });
  });

  it("rejects same Excel keys with different business meanings and report sources", () => {
    const target = contract("refining");
    target.datasets.detail!.fields = [{ field: "id", semanticKey: "heat-number", type: "text" }, { field: "c_C", label: "规格", semanticKey: "product-size" }, { field: "weight", semanticKey: "tap-weight", type: "number", unit: "kg" }];
    const checked = inspectReportTemplateCompatibility(template(), target);
    expect(checked.ok).toBe(false);
    expect(checked.issues).toContainEqual(expect.objectContaining({ code: "source" }));
    expect(checked.issues).toContainEqual(expect.objectContaining({ code: "semantic", field: "c_C", dataset: "detail" }));
  });

  it("reports missing fields, units and declared types without converting any values", () => {
    const target = contract();
    target.datasets.detail!.fields = [{ field: "id", semanticKey: "heat-number", type: "text" }, { field: "weight", semanticKey: "tap-weight", type: "decimal", unit: "t" }];
    const checked = inspectReportTemplateCompatibility(template(), target);
    expect(checked.issues.map(issue => issue.code)).toEqual(["field", "type", "unit"]);
  });

  it("checks formula-only dependencies but excludes generated outputs", () => {
    const value = template();
    const list = value.pages[0]!.components.find(item => item.kind === "list")!;
    if (list.kind !== "list") throw new Error("fixture");
    list.columns.push({ field: "derived", header: "Calculated", widthMm: 20 });
    list.computed = [{ field: "derived", expression: { op: "add", args: [{ field: "unbound" }, { value: 1 }] } }];
    const result = inspectReportTemplateCompatibility(value, contract());
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ code: "field", field: "unbound" });
  });

  it("does not assume unversioned templates are compatible", () => {
    const value = template();
    delete value.dataContract;
    expect(validateReportTemplate(value).ok).toBe(true);
    expect(inspectReportTemplateCompatibility(value, contract()).issues[0]?.code).toBe("contract");
  });

  it("reports an undeclared dataset and validates malformed contracts during import", () => {
    const target = contract();
    const value = template();
    const list = value.pages[0]!.components.find(item => item.kind === "list")!;
    if (list.kind !== "list") throw new Error("fixture");
    list.dataset = "another";
    expect(inspectReportTemplateCompatibility(value, target).issues[0]?.code).toBe("dataset");
    expect(() => defineReportTemplate({ id: "bad", name: "bad", template: { ...value, dataContract: { datasets: { detail: { fields: [{ field: "same" }, { field: "same" }] } } } } })).toThrow("字段名");
    const dangerous = JSON.parse('{"datasets":{"__proto__":{"fields":[{"field":"a"}]}}}');
    expect(inspectReportTemplateCompatibility(template(), dangerous).issues[0]?.code).toBe("contract");
  });
});

describe("template query context", () => {
  it("refreshes moved context text, clears stale measured text and preserves the input", () => {
    const value = template();
    value.pages[0]!.components.push({ kind: "text", leftMm: 30, topMm: 23, widthMm: 70, heightMm: 5, text: "old date", rawText: "old date", lines: ["old date"], meta: { contextKey: "query" }, style: { color: "#123456" } });
    const bound = bindReportTemplateContext(value, { query: "YTS1 / 2026-11-05" });
    const component = bound.pages[0]!.components.at(-1)!;
    if (component.kind !== "text") throw new Error("fixture");
    expect(component).toMatchObject({ text: "YTS1 / 2026-11-05", leftMm: 30, topMm: 23, style: { color: "#123456" } });
    expect(component.lines).toBeUndefined();
    expect(component.rawText).toBeUndefined();
    const original = value.pages[0]!.components.at(-1)!;
    expect(original.kind === "text" && original.text).toBe("old date");
  });

  it("leaves unbound prose intact and ignores inherited context keys", () => {
    const value = template();
    value.pages[0]!.components.push({ kind: "text", leftMm: 0, topMm: 0, widthMm: 10, heightMm: 5, text: "own prose", meta: { contextKey: "toString" } });
    const bound = bindReportTemplateContext(value, {}).pages[0]!.components.at(-1)!;
    expect(bound.kind === "text" && bound.text).toBe("own prose");
    expect(() => bindReportTemplateContext(value, { toString: 2 } as unknown as Record<string, string>)).toThrow(TypeError);
  });
});
