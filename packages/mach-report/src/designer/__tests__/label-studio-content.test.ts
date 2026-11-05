import { afterEach, expect, it, vi } from "vitest";
import { parseReportTemplate, type DatasetContract } from "@agile-team/mach-report";
import { createLabelStudioDocument } from "../label-studio-template";
import { isCustomLabelStudioLayout, patchLabelStudioContent, rebuildLabelStudioDocument } from "../label-studio-content";
import { labelStudioSheetLayout } from "../label-studio-sheets";
const schema: DatasetContract = { rowKey: "id", fields: [{ field: "id", type: "text" }, { field: "heat", type: "text", semanticRole: "identifier" }, { field: "weight", label: "重量", type: "number" }, { field: "grade", label: "钢种", type: "text" }] };
afterEach(() => { vi.unstubAllGlobals(); });
const layout = { preset: "material" as const, fields: ["weight"], brand: { name: "原标题" } };
it("updates managed content while keeping manual geometry, styles, extra pages and original zero bindings", () => {
  const source = createLabelStudioDocument(schema, "标签", undefined, layout);
  const field = source.template.pages[0]!.components.find(component => component.meta?.labelStudioRole === "field-value")!;
  if (field.kind === "list") throw new Error("expected a bound field");
  field.leftMm = 26;
  field.style = { ...field.style, color: "#123456" };
  source.template.pages.push({ widthMm: 80, heightMm: 55, components: [{ kind: "text", text: "手工附页", leftMm: 2, topMm: 2, widthMm: 50, heightMm: 5 }] });
  const original = JSON.stringify(source);
  const next = patchLabelStudioContent(source, schema, "标签", undefined, layout, { ...layout, fields: ["grade"], brand: { name: "新标题" } })!;
  expect(next).toBeDefined();
  const value = next.template.pages[0]!.components.find(component => component.meta?.labelStudioRole === "field-value");
  expect(value).toMatchObject({ leftMm: 26, style: { color: "#123456" }, binding: { field: "grade" } });
  expect(next.template.pages[1]).toEqual(source.template.pages[1]);
  expect(JSON.stringify(source)).toBe(original);
  expect(isCustomLabelStudioLayout(source, createLabelStudioDocument(schema, "标签", undefined, layout))).toBe(true);
});
it("adopts unchanged legacy preset components and rejects insertion that would overlap custom content", () => {
  const legacy = createLabelStudioDocument(schema, "标签", undefined, layout);
  for (const component of legacy.template.pages[0]!.components) delete component.meta;
  const next = patchLabelStudioContent(legacy, schema, "标签", undefined, layout, { ...layout, brand: { name: "新标题" } });
  expect(next?.template.pages[0]!.components.some(component => component.kind === "text" && component.text === "新标题")).toBe(true);
  const blocked = parseReportTemplate(next!);
  blocked.template.pages[0]!.components.push({ kind: "text", text: "自定义内容", leftMm: 4, topMm: 27.7, widthMm: 45, heightMm: 4 });
  expect(patchLabelStudioContent(blocked, schema, "标签", undefined, layout, { ...layout, fields: ["weight", "grade"] })).toBeUndefined();
});
it("computes A4 capacity from every current physical page and refuses mixed or oversized layouts", () => {
  const material = createLabelStudioDocument(schema, "标签", undefined, layout);
  expect(labelStudioSheetLayout(material.template)).toMatchObject({ columns: 2, rows: 4, capacity: 8 });
  const warehouse = createLabelStudioDocument(schema, "标签", undefined, { ...layout, preset: "warehouse" });
  expect(labelStudioSheetLayout(warehouse.template)).toMatchObject({ columns: 1, rows: 4, capacity: 4 });
  warehouse.template.pages[0]!.widthMm = 200;
  expect(labelStudioSheetLayout(warehouse.template)).toBeUndefined();
  material.template.pages.push({ widthMm: 100, heightMm: 60, components: [] });
  expect(labelStudioSheetLayout(material.template)).toBeUndefined();
});

it("changing only fields preserves manually edited brand text and adding a subtitle never moves custom content", () => {
  const source = createLabelStudioDocument(schema, "标签", undefined, layout);
  const name = source.template.pages[0]!.components.find(component => component.meta?.labelStudioRole === "brand-name")!;
  if (name.kind !== "text") throw new Error("expected a title");
  name.text = "画布手工标题";
  const fields = patchLabelStudioContent(source, schema, "标签", undefined, layout, { ...layout, fields: ["grade"] })!;
  expect(fields.template.pages[0]!.components.some(component => component.kind === "text" && component.text === "画布手工标题")).toBe(true);
  const subtitle = patchLabelStudioContent(fields, schema, "标签", undefined, { ...layout, fields: ["grade"] }, { ...layout, fields: ["grade"], brand: { name: "原标题", tagline: "副标题" } })!;
  expect(subtitle.template.pages[0]!.components.some(component => component.kind === "text" && component.text === "副标题")).toBe(true);
  const removed = patchLabelStudioContent(subtitle, schema, "标签", undefined, { ...layout, fields: ["grade"], brand: { name: "原标题", tagline: "副标题" } }, { ...layout, fields: ["grade"] })!;
  expect(removed.template.pages[0]!.components.some(component => component.meta?.labelStudioRole === "brand-tagline")).toBe(false);
});

it("empty optional brand values do not overwrite manually edited titles during a field-only change", () => {
  const previous = { preset: "material" as const, fields: ["weight"], brand: {} };
  const source = createLabelStudioDocument(schema, "标签", undefined, previous);
  const name = source.template.pages[0]!.components.find(component => component.meta?.labelStudioRole === "brand-name")!;
  if (name.kind !== "text") throw new Error("expected a title");
  name.text = "手工标题";
  const updated = patchLabelStudioContent(source, schema, "标签", undefined, previous, { ...previous, fields: ["grade"], brand: { name: "", tagline: "" } })!;
  expect(updated.template.pages[0]!.components.some(component => component.kind === "text" && component.text === "手工标题")).toBe(true);
});

it("content updates, additions and explicit rebuilds work without structuredClone and retain independent source data", () => {
  vi.stubGlobal("structuredClone", undefined);
  const source = createLabelStudioDocument(schema, "标签", undefined, layout);
  const original = JSON.stringify(source);
  const desired = { ...layout, fields: ["grade", "weight"], brand: { name: "更新标题", tagline: "新副标题" } };
  const next = patchLabelStudioContent(source, schema, "标签", undefined, layout, desired)!;
  expect(next).toBeDefined();
  expect(next.template.pages[0]!.components.filter(component => component.meta?.labelStudioRole === "field-value")).toHaveLength(2);
  expect(next.template.pages[0]!.components.some(component => component.kind === "text" && component.text === "新副标题")).toBe(true);
  expect(isCustomLabelStudioLayout(source, createLabelStudioDocument(schema, "标签", undefined, layout))).toBe(false);
  expect(rebuildLabelStudioDocument(next, schema, "标签", undefined, { ...desired, preset: "warehouse" }).template.pages[0]!.widthMm).toBe(100);
  const binding = next.template.pages[0]!.components.find(component => component.kind === "text" && component.binding?.field === "grade");
  if (binding?.kind !== "text" || !binding.binding) throw new Error("expected transferred field binding");
  binding.binding.field = "manually-changed";
  expect(JSON.stringify(source)).toBe(original);
  expect(desired.fields).toEqual(["grade", "weight"]);
});
