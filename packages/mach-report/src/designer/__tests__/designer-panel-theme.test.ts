import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@vue/test-utils";
import { compileStyle, parse } from "vue/compiler-sfc";
import { computed, type Component } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { defineReportTemplate, type PlanComponent } from "../../index";
import { defineMachReportConfig } from "../../vue/config";
import { MACH_REPORT_CONFIG_KEY } from "../../vue/injection-keys";
import CanvasComponentInspector from "../CanvasComponentInspector.vue";
import ChartBindingInspector from "../ChartBindingInspector.vue";
import ColumnVisualEditor from "../ColumnVisualEditor.vue";
import TemplatePageInspector from "../TemplatePageInspector.vue";
import TemplateRepeatInspector from "../TemplateRepeatInspector.vue";
import TemplateReviewPanel from "../TemplateReviewPanel.vue";
import TemplateOutlinePanel from "../TemplateOutlinePanel.vue";
import TemplateReusePanel from "../TemplateReusePanel.vue";
import TemplateDesignCanvas from "../TemplateDesignCanvas.vue";

const theme = {
  colorScheme: "dark" as const,
  shellBg: "#090f20", shellFg: "#f8fafc", toolbarBg: "#10182d", toolbarFg: "#f8fafc",
  toolbarBorder: "#39465a", btnFg: "#b7c4da", btnBorder: "#536681", btnHoverFg: "#94e5da",
  btnHoverBg: "#193b39", btnActiveBg: "#6ee7b7", btnActiveFg: "#08130f",
  errorFg: "#ffaaaa", warningFg: "#fcd34d", successFg: "#86efac",
};
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach(close => close()));
const component: PlanComponent = { kind: "text", leftMm: 5, topMm: 5, widthMm: 30, heightMm: 10, text: "业务正文", style: { color: "#123456", backgroundColor: "#ffeedd" } };
const codeImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1EAAAAASUVORK5CYII=";
const document = () => defineReportTemplate({ id: "panel-theme", name: "主题", template: { repeat: { dataset: "records" }, pages: [{ widthMm: 80, heightMm: 55, components: [component, { kind: "qrcode", leftMm: 50, topMm: 5, widthMm: 15, heightMm: 15, imageData: codeImage }] }] } });

// Happy DOM leaves an inherited computed color as the literal "inherit".
function inheritedColor(element: Element): string {
  const color = getComputedStyle(element).color;
  return color === "inherit" && element.parentElement ? inheritedColor(element.parentElement) : color;
}

/** Compile the component's actual scoped CSS so tests exercise its declarations. */
function themedPanel(definition: Component, filename: string, props: Record<string, unknown>) {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", filename), "utf8");
  const scopeId = (definition as { __scopeId?: string }).__scopeId ?? "data-v-theme-test";
  const css = parse(source).descriptor.styles.filter(style => !style.src).map(style => {
    const result = compileStyle({ source: style.content, filename, id: scopeId, scoped: true });
    expect(result.errors).toEqual([]);
    return result.code;
  }).join("\n");
  const sheet = globalThis.document.createElement("style"); sheet.textContent = css;
  globalThis.document.head.append(sheet);
  const host = globalThis.document.createElement("div");
  const config = computed(() => defineMachReportConfig({ defaults: { theme } }));
  host.style.cssText = "--mrp-toolbar-bg:#10182d;--mrp-toolbar-fg:#f8fafc;--mrp-toolbar-border:#39465a;--mrp-btn-fg:#b7c4da;--mrp-btn-active-bg:#6ee7b7;--mrp-shell-bg:#090f20";
  globalThis.document.body.append(host);
  const wrapper = mount(definition, { props, attachTo: host, global: { provide: { [MACH_REPORT_CONFIG_KEY as symbol]: config } } });
  cleanup.push(() => { wrapper.unmount(); host.remove(); sheet.remove(); });
  return wrapper;
}

describe("designer panel theme boundaries", () => {
  it.each([
    { definition: CanvasComponentInspector, filename: "CanvasComponentInspector.vue", props: { component }, selector: 'input[type="number"]' },
    { definition: TemplatePageInspector, filename: "TemplatePageInspector.vue", props: { document: document(), pageIndex: 0 }, selector: "input" },
    { definition: TemplateRepeatInspector, filename: "TemplateRepeatInspector.vue", props: { document: document(), datasets: ["records"] }, selector: 'input[type="number"]' },
  ])("$filename inherits dark controls and retains document colors", ({ definition, filename, props, selector }) => {
    const wrapper = themedPanel(definition, filename, props);
    const input = wrapper.get(selector).element;
    expect(getComputedStyle(input).backgroundColor).toBe(theme.toolbarBg);
    expect(inheritedColor(input)).toBe(theme.toolbarFg);
    if (filename === "CanvasComponentInspector.vue") {
      expect(wrapper.findAll('input[type="color"]').map(control => (control.element as HTMLInputElement).value)).toEqual(["#123456", "#ffeedd"]);
    }
    expect(component.style).toEqual({ color: "#123456", backgroundColor: "#ffeedd" });
  });

  it.each([
    { definition: TemplateReviewPanel, filename: "TemplateReviewPanel.vue", props: { document: document() } },
    { definition: TemplateOutlinePanel, filename: "TemplateOutlinePanel.vue", props: { document: document() } },
    { definition: TemplateReusePanel, filename: "TemplateReusePanel.vue", props: { document: document(), pageIndex: 0, accept: () => true } },
    { definition: ColumnVisualEditor, filename: "ColumnVisualEditor.vue", props: { modelValue: { kind: "dataBar", color: "#123456", negativeColor: "#765432" } } },
    { definition: ChartBindingInspector, filename: "ChartBindingInspector.vue", props: { component: { kind: "chart", leftMm: 0, topMm: 0, widthMm: 80, heightMm: 50, chartBinding: { dataset: "records", categoryField: "grade", type: "bar", measures: [{ op: "count" }] } } } },
  ])("$filename resolves application theme through its standalone entry", ({ definition, filename, props }) => {
    const wrapper = themedPanel(definition, filename, props);
    const root = wrapper.element as HTMLElement;
    expect(root.style.getPropertyValue("--mrp-toolbar-bg")).toBe(theme.toolbarBg);
    expect(root.style.getPropertyValue("--mrp-toolbar-fg")).toBe(theme.toolbarFg);
    expect(root.style.getPropertyValue("--mrp-btn-active-fg")).toBe(theme.btnActiveFg);
    expect(root.style.getPropertyValue("--mrp-error-fg")).toBe(theme.errorFg);
    if (filename === "ColumnVisualEditor.vue") {
      expect(wrapper.findAll('input[type="color"]').map(control => (control.element as HTMLInputElement).value)).toEqual(["#123456", "#765432"]);
      expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    }
  });

  it("keeps physical white paper, original ink and payload separate from the themed canvas UI", () => {
    const original = document();
    const wrapper = themedPanel(TemplateDesignCanvas, "TemplateDesignCanvas.vue", { document: original, pageIndex: 0 });
    expect(getComputedStyle(wrapper.get(".mr-canvas-heading").element).backgroundColor).toBe(theme.toolbarBg);
    const paper = getComputedStyle(wrapper.get(".mr-canvas-paper").element);
    expect(paper.backgroundColor).toBe("#fff");
    expect(paper.color).toBe("#000");
    expect(paper.colorScheme).toBe("light");
    expect(original.template.pages[0]!.components[0]).toEqual(component);
    expect(wrapper.get('[data-canvas-component="1"] img').attributes("src")).toBe(codeImage);
    expect(wrapper.emitted()).toEqual({});
  });
});
