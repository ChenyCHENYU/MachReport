import { afterEach, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlanComponent, RenderPlan } from "../../schema/render-plan";
import type { ReportValidationIssue } from "../../editing/validation";
import ReportValidationPanel from "../ReportValidationPanel.vue";
import { resolveValidationPanelMessages, validationPanelText } from "../validation-panel-messages";

const wrappers: VueWrapper[] = [];
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.replaceChildren(); });
function fixture(count = 237) {
  const issues: ReportValidationIssue[] = Array.from({ length: count }, (_, index) => ({ ruleId: `rule${index}`, severity: index % 2 ? "warning" : "error", dataset: ["A", "B", "C"][index % 3]!, sourceScope: "plant", rowKey: index, field: "amount", message: `校验问题 ${index}` }));
  const header: PlanComponent = { kind: "rect", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 8, table: { id: "production", role: "header", rowIndex: -1, columnKeys: ["amount"] }, grid: { cells: [[{ text: "产量（t）" }]] } };
  const components: PlanComponent[] = [header, ...issues.map((issue, index): PlanComponent => ({ kind: "rect", leftMm: 0, topMm: 8 * (index + 1), widthMm: 40, heightMm: 8,
    table: { id: "production", role: "body", rowIndex: index, columnKeys: ["amount"], source: { sourceScope: issue.sourceScope, datasetId: issue.dataset!, rowKey: issue.rowKey } }, grid: { cells: [[{ text: String(index), value: index }]] }
  }))];
  const plan: RenderPlan = { schemaVersion: "validation", pages: [{ pageWidthMm: 40, pageHeightMm: 8 * (count + 1), components }] };
  return { issues, plan };
}
function render(props = fixture()) { const wrapper = mount(ReportValidationPanel, { props, attachTo: document.body }); wrappers.push(wrapper); return wrapper; }
function color(value: string): string { const element = document.createElement("span"); element.style.color = value; document.body.append(element); const result = getComputedStyle(element).color; element.remove(); return result; }

it("makes all issues reachable in bounded pages with exact counts and original cross-page targets", async () => {
  const props = fixture(), wrapper = render(props);
  expect(wrapper.findAll("li")).toHaveLength(100); expect(wrapper.text()).toContain("119 错误 · 118 提示");
  expect(wrapper.text()).toContain("匹配 237 项 · 共 237 项"); expect(wrapper.text()).toContain("1–100 / 237");
  wrapper.get("ul").element.scrollTop = 100;
  await wrapper.get('button[aria-label="下一页"]').trigger("click");
  expect(wrapper.findAll("li")).toHaveLength(100); expect(wrapper.text()).toContain("101–200 / 237");
  expect(wrapper.get("ul").element.scrollTop).toBe(0);
  await wrapper.get('button[aria-label="下一页"]').trigger("click");
  expect(wrapper.findAll("li")).toHaveLength(37); expect(wrapper.text()).toContain("201–237 / 237");
  expect(wrapper.get('button[aria-label="下一页"]').attributes("disabled")).toBeDefined();
  await wrapper.findAll("li").at(-1)!.get("button").trigger("click");
  expect(wrapper.emitted("locate")?.[0]).toEqual([props.issues[236]]);
  await wrapper.setProps({ issues: props.issues.slice(0, 5) });
  expect(wrapper.findAll("li")).toHaveLength(5); expect(wrapper.text()).toContain("1–5 / 5");
});

it("combines severity, dataset and business-label searches without losing the global total", async () => {
  const props = fixture(), wrapper = render(props);
  await wrapper.findAll("select")[0]!.setValue("warning");
  await wrapper.findAll("select")[1]!.setValue("B");
  const expected = props.issues.filter(issue => issue.severity === "warning" && issue.dataset === "B").length;
  expect(wrapper.findAll("li")).toHaveLength(expected);
  expect(wrapper.text()).toContain(`匹配 ${expected} 项 · 共 237 项`);
  await wrapper.get("input").setValue("产量 235");
  expect(wrapper.findAll("li")).toHaveLength(1); expect(wrapper.text()).toContain("校验问题 235");
  await wrapper.get("input").setValue("unknown");
  expect(wrapper.findAll("li")).toHaveLength(0); expect(wrapper.text()).toContain("没有匹配的校验问题");
  await wrapper.get(".mr-validation__clear").trigger("click");
  expect(wrapper.findAll("li")).toHaveLength(100); expect(document.activeElement).toBe(wrapper.get("input").element);
});

it("commits IME search only when composition ends and retains input focus while clearing with Escape", async () => {
  const wrapper = render(), search = wrapper.get("input");
  (search.element as HTMLInputElement).focus(); await search.trigger("compositionstart");
  (search.element as HTMLInputElement).value = "校验问题 236";
  await search.trigger("input", { isComposing: true });
  await search.trigger("keydown", { key: "Escape", isComposing: true });
  expect(wrapper.findAll("li")).toHaveLength(100);
  await search.trigger("compositionend");
  expect(wrapper.findAll("li")).toHaveLength(1); expect(wrapper.text()).toContain("校验问题 236");
  expect(document.activeElement).toBe(search.element);
  await search.trigger("keydown", { key: "Escape" });
  expect(wrapper.findAll("li")).toHaveLength(100); expect(document.activeElement).toBe(search.element);
});

it("does not navigate missing, wrongly scoped, row-index-only or conflicting mirror targets", async () => {
  const props = fixture(1), first = props.issues[0]!;
  props.issues.push({ ...first, rowKey: 999 }, { ...first, sourceScope: "other-plant" }, { ...first, rowKey: undefined, rowIndex: 0 }, { ...first, dataset: "B" });
  const duplicate = structuredClone(props.plan.pages[0]!.components[1]!); duplicate.grid!.cells[0]![0]!.value = 999;
  props.plan.pages[0]!.components.push(duplicate);
  const wrapper = render(props);
  const buttons = wrapper.findAll("li button"); expect(buttons).toHaveLength(4);
  for (const button of buttons) { expect(button.attributes("disabled")).toBeDefined(); await button.trigger("click"); }
  expect(wrapper.emitted("locate")).toBeUndefined();
  await wrapper.setProps({ plan: undefined });
  expect(wrapper.findAll("li button").every(button => button.attributes("disabled") !== undefined)).toBe(true);
});

it("keeps loading and empty results explicit, with stable labels and disabled locations", async () => {
  const props = fixture(1), wrapper = render(props);
  await wrapper.setProps({ busy: true });
  expect(wrapper.get("section").attributes("aria-busy")).toBe("true");
  expect(wrapper.text()).toContain("正在校验…"); expect(wrapper.get("li button").attributes("disabled")).toBeDefined();
  await wrapper.setProps({ issues: [], busy: false });
  expect(wrapper.findAll("li")).toHaveLength(0); expect(wrapper.text()).toContain("暂无校验问题"); expect(wrapper.text()).toContain("匹配 0 项 · 共 0 项");
  expect(wrapper.find("input").exists()).toBe(false);
  await wrapper.setProps({ busy: true }); expect(wrapper.text()).toContain("正在校验…");
});

it("inherits dark surfaces and semantic severities through the existing preview theme variables", () => {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../ReportValidationPanel.vue"), "utf8");
  const stylesheet = document.createElement("style"); stylesheet.textContent = source.match(/<style scoped>([\s\S]+)<\/style>/)![1]!; document.head.append(stylesheet);
  const wrapper = render(fixture(2));
  (wrapper.element as HTMLElement).style.cssText = "--mrp-toolbar-bg:#142237;--mrp-toolbar-fg:#eef5ff;--mrp-btn-fg:#c3d4ef;--mrp-toolbar-border:#314761;--mrp-btn-border:#314761;--mrp-btn-hover-bg:#23334b;--mrp-error-fg:#ff9caa;--mrp-warning-fg:#ffd27b;color-scheme:dark";
  try {
    expect(getComputedStyle(wrapper.element).backgroundColor).toBe(color("#142237"));
    expect(getComputedStyle(wrapper.get("strong").element).color).toBe(color("#eef5ff"));
    expect(getComputedStyle(wrapper.get(".is-error .mr-validation__badge").element).color).toBe(color("#ff9caa"));
    expect(getComputedStyle(wrapper.findAll(".mr-validation__badge")[1]!.element).color).toBe(color("#ffd27b"));
    expect(source).not.toContain("--mr-color-"); expect(source).toContain("--mrp-btn-active-bg");
  } finally { stylesheet.remove(); }
});

it("keeps legacy message overrides and complete localized count tokens", () => {
  const messages = resolveValidationPanelMessages({ title: undefined, locate: "Go", more: "Legacy", results: "{matched}/{total} ({matched})" });
  expect(messages.title).toBe("数据校验"); expect(messages.locate).toBe("Go"); expect(messages.more).toBe("Legacy");
  expect(validationPanelText(messages.results, { matched: 3, total: 237 })).toBe("3/237 (3)");
  expect(validationPanelText("{unknown}", {})).toBe("{unknown}");
});
