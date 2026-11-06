import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { compileStyle, parse } from "vue/compiler-sfc";
import type { Component } from "vue";
import { defineReportTemplate } from "../../index";
import RuleDataLayout from "../RuleDataLayout.vue";
import ReportExpressionEditor from "../ReportExpressionEditor.vue";
import ReportPredicateEditor from "../ReportPredicateEditor.vue";
import ParamTreeOptionsEditor from "../ParamTreeOptionsEditor.vue";
import TemplateFixtureComparison from "../TemplateFixtureComparison.vue";
import { DEFAULT_RULE_EDITOR_MESSAGES } from "../rule-messages";
import { PARAM_EDITOR_MESSAGES } from "../param-messages";

const files = ["RuleDataLayout", "ReportExpressionEditor", "ReportPredicateEditor", "ParamTreeOptionsEditor", "TemplateFixtureComparison"] as const;
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach(close => close()));
function styles(filename: string) {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", `${filename}.vue`), "utf8");
  return parse(source).descriptor.styles.filter(style => !style.src).map(style => style.content).join("\n");
}
function mountThemed(definition: Component, filename: string, props: Record<string, unknown>): VueWrapper {
  const id = (definition as { __scopeId?: string }).__scopeId ?? "data-v-internal-theme";
  const result = compileStyle({ source: styles(filename), filename, id, scoped: true }); expect(result.errors).toEqual([]);
  const sheet = document.createElement("style"); sheet.textContent = result.code; document.head.append(sheet);
  const host = document.createElement("section"); host.style.cssText = "--mrp-toolbar-bg:rgb(16, 24, 45);--mrp-toolbar-fg:rgb(248, 250, 252);--mrp-toolbar-border:#39465a;--mrp-btn-fg:#b7c4da;--mrp-btn-hover-bg:#193b39;--mrp-btn-hover-fg:#94e5da;--mrp-btn-active-bg:#6ee7b7;--mrp-btn-active-fg:#08130f;--mrp-error-fg:#ffaaaa"; document.body.append(host);
  const wrapper = mount(definition, { props, attachTo: host }); cleanup.push(() => { wrapper.unmount(); host.remove(); sheet.remove(); }); return wrapper;
}
it.each(files)("%s scopes every control color to shared theme tokens and keeps compatible mix fallbacks", filename => {
  const css = compileStyle({ source: styles(filename), filename, id: "data-v-palette", scoped: true }); expect(css.errors).toEqual([]);
  css.rawResult!.root!.walkDecls(declaration => {
    expect(declaration.value.replace(/var\([^)]*\)/g, "")).not.toMatch(/#[\da-f]{3,8}\b|\bwhite\b|rgba?\(/i);
    expect(declaration.value).not.toContain("--mr-color-");
    if (!declaration.value.includes("color-mix(")) return;
    const previous = declaration.prev(); expect(previous?.type).toBe("decl");
    if (previous?.type !== "decl") return;
    expect(previous.prop).toBe(declaration.prop); expect(previous.value).not.toContain("color-mix(");
  });
});
it.each([
  [RuleDataLayout, "RuleDataLayout", { mode: "detail", list: { kind: "list", dataset: "detail", leftMm: 0, topMm: 0, widthMm: 80, columns: [{ field: "id", header: "编号", widthMm: 80 }] }, messages: DEFAULT_RULE_EDITOR_MESSAGES }, "input"],
  [ReportExpressionEditor, "ReportExpressionEditor", { modelValue: { value: 42 }, fields: [{ field: "qty", label: "数量" }], messages: DEFAULT_RULE_EDITOR_MESSAGES }, "input"],
  [ReportPredicateEditor, "ReportPredicateEditor", { modelValue: { field: "qty", op: ">", value: 0 }, fields: [{ field: "qty", label: "数量" }], messages: DEFAULT_RULE_EDITOR_MESSAGES }, "input"],
  [ParamTreeOptionsEditor, "ParamTreeOptionsEditor", { modelValue: [{ value: "A", label: "甲" }], messages: PARAM_EDITOR_MESSAGES }, "input"],
] as const)("%s inherits dark surface/ink without modifying business input", (definition, filename, props, selector) => {
  const before = JSON.stringify(props), wrapper = mountThemed(definition as Component, filename, props);
  const control = wrapper.get(selector).element;
  expect(getComputedStyle(control).backgroundColor).toBe("rgb(16, 24, 45)"); expect(getComputedStyle(control).color).toBe("rgb(248, 250, 252)");
  expect(JSON.stringify(props)).toBe(before);
});
it("fixture comparison themes only its UI heading while keeping declared report ink and paper", () => {
  const authored = { kind: "text" as const, leftMm: 5, topMm: 5, widthMm: 40, heightMm: 10, text: "业务正文", style: { color: "#123456", backgroundColor: "#ffeedd" } };
  const template = defineReportTemplate({ id: "fixture-theme", name: "主题", template: { pages: [{ widthMm: 80, heightMm: 55, components: [authored] }] } });
  const wrapper = mountThemed(TemplateFixtureComparison, "TemplateFixtureComparison", { document: template, fixture: { name: "样例", datasets: {} } });
  expect(getComputedStyle(wrapper.get("h4").element).backgroundColor).toBe("rgb(16, 24, 45)"); expect(getComputedStyle(wrapper.get("h4").element).color).toBe("rgb(248, 250, 252)");
  expect(template.template.pages[0]!.components[0]).toEqual(authored); expect(wrapper.emitted()).toEqual({});
});
