import { expect, it } from "vitest";
import fc from "fast-check";
import { renderPlan } from "../../render/dom";
import { fuzzOptions } from "./options";

it("HTML and Word-compatible serialization keep arbitrary text as text, never executable markup", () => {
  const content = fc.oneof(fc.string({ maxLength: 128 }), fc.constantFrom('<script>window.changed=true</script>', '<img src=x onerror="window.changed=true">', '</div><iframe src="https://example.invalid">', '中文 & "quotes" < > 🏭'));
  fc.assert(fc.property(content, text => {
    const root = renderPlan({ schemaVersion: "fuzz", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [{ kind: "text", leftMm: 10, topMm: 10, widthMm: 180, heightMm: 40, text }] }] }, document);
    expect(root.textContent).toBe(text);
    const parsed = document.createElement("template"); parsed.innerHTML = root.outerHTML;
    expect(parsed.content.querySelectorAll("script,iframe,object,embed,img")).toHaveLength(0);
    for (const element of parsed.content.querySelectorAll("*")) expect(element.getAttributeNames().some(name => /^on/i.test(name))).toBe(false);
  }), fuzzOptions(9));
});
