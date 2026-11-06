// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileStyle } from "vue/compiler-sfc";

const files = ["label-studio", "template-editor", "template-library", "template-product", "report-batch", "param-editor", "excel-binding"] as const;
const styles = new Map(files.map(file => [file, compileStyle({ source: readFileSync(new URL(`../${file}.css`, import.meta.url), "utf8"), filename: `${file}.css`, id: "external-theme" })]));

function values(file: typeof files[number], selector: string, property: string): string[] {
  const result: string[] = [];
  styles.get(file)!.rawResult!.root!.walkRules(selector, rule => { rule.walkDecls(property, declaration => { result.push(declaration.value); }); });
  return result;
}

describe("designer external stylesheet theme boundaries", () => {
  it.each(files)("%s compiles and does not overwrite inherited shared tokens", file => {
    const style = styles.get(file)!;
    expect(style.errors).toEqual([]);
    const overrides: string[] = [];
    style.rawResult!.root!.walkDecls(declaration => { if (declaration.prop.startsWith("--mrp-")) overrides.push(declaration.prop); });
    expect(overrides).toEqual([]);
  });

  it.each(files)("%s keeps a plain fallback before every color-mix enhancement", file => {
    styles.get(file)!.rawResult!.root!.walkDecls(declaration => {
      if (!declaration.value.includes("color-mix(")) return;
      const previous = declaration.prev();
      expect(previous?.type).toBe("decl");
      if (previous?.type !== "decl") return;
      expect(previous.prop).toBe(declaration.prop);
      expect(previous.value).not.toContain("color-mix(");
    });
  });

  it.each(files)("%s keeps literal palettes confined to paper artwork and worksheet content", file => {
    const fixed: string[] = [];
    styles.get(file)!.rawResult!.root!.walkDecls(declaration => {
      const selector = declaration.parent?.type === "rule" ? declaration.parent.selector : "";
      if (selector.includes(".mr-label-preset-art")) return;
      const colors = declaration.value.replace(/var\([^)]*\)/g, "").match(/#[\da-f]{3,8}\b|\bwhite\b|rgba?\(/gi) ?? [];
      if (!colors.length) return;
      const paper = selector === ".mr-binding-grid" || selector === ".mr-binding-grid th,\n.mr-binding-grid td";
      if (paper || selector.startsWith(".mr-binding-grid ") && colors.every(color => color === "#fff")) return;
      fixed.push(`${selector} ${declaration.prop}: ${declaration.value}`);
    });
    expect(fixed).toEqual([]);
  });

  it.each([
    ["label-studio", ".mr-label-studio"], ["template-editor", ".mr-designer"], ["template-library", ".mr-library"],
    ["template-product", ".mr-product-panel"], ["report-batch", ".mr-batch"], ["param-editor", ".mr-param-editor"], ["excel-binding", ".mr-binding"]
  ] as const)("%s has explicit themed foreground and background at its independent root", (file, selector) => {
    expect(values(file, selector, "color").join(" ")).toMatch(/var\(--mrp-(toolbar|shell)-fg/);
    expect(values(file, selector, "background").join(" ")).toContain("var(--mrp-toolbar-bg");
  });

  it.each([
    ["template-editor", ".mr-designer .mr-designer-save"], ["template-product", ".mr-reuse-primary"],
    ["report-batch", ".mr-batch .is-primary"], ["param-editor", ".mr-param-editor .is-primary"], ["excel-binding", ".mr-binding button.mr-binding-primary"]
  ] as const)("%s pairs its primary fill with the active foreground", (file, selector) => {
    expect(values(file, selector, "color")).toContain("var(--mrp-btn-active-fg, #fff)");
    expect(values(file, selector, "background").join(" ")).toMatch(/var\(--(?:mrp-btn-active-bg|mr-binding-blue)/);
  });

  it("keeps binding states distinct and paper content readable", () => {
    expect(values("excel-binding", ".mr-binding-region-state", "color").join(" ")).toContain("var(--mrp-warning-fg");
    expect(values("excel-binding", '.mr-binding-region-entry[data-state="ready"] .mr-binding-region-state', "color").join(" ")).toContain("var(--mrp-success-fg");
    expect(values("excel-binding", '.mr-binding-region-entry[data-state="error"] .mr-binding-region-state', "color").join(" ")).toContain("var(--mrp-error-fg");
    expect(values("excel-binding", ".mr-binding-grid", "background")).toEqual(["white"]);
    expect(values("excel-binding", ".mr-binding-grid", "color")).toEqual(["#475569"]);
    expect(values("label-studio", ".mr-label-preset-art", "background")).toEqual(["#fff"]);
  });
});
