import { afterEach, describe, expect, it } from "vitest";
import { focusDesignerControl } from "../designer-focus";

afterEach(() => { document.body.innerHTML = ""; });
describe("designer destination control focus", () => {
  it("opens the existing disclosure and focuses its requested control", () => {
    const root = document.createElement("section");
    root.innerHTML = '<input value="first"><details><summary>边距</summary><input data-mr-control="page-marginTopMm"></details>';
    document.body.append(root);
    expect(focusDesignerControl(root, "page-marginTopMm")).toBe(true);
    expect(root.querySelector("details")!.open).toBe(true);
    expect(document.activeElement?.getAttribute("data-mr-control")).toBe("page-marginTopMm");
  });
  it("rejects selector syntax and reports when only a broader destination exists", () => {
    const root = document.createElement("section");
    root.innerHTML = '<input disabled><button>配置入口</button>';
    document.body.append(root);
    expect(focusDesignerControl(root, '"] * [')).toBe(false);
    expect(document.activeElement).toBe(root.querySelector("button"));
    expect(focusDesignerControl(undefined, "field")).toBe(false);
  });
});
