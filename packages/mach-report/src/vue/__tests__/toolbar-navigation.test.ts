// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createTableTemplate, paginateTemplate } from "../../index";
import { DEFAULT_MESSAGES } from "../config";
import ReportToolbar from "../ReportToolbar.vue";
import ReportNavigation from "../ReportNavigation.vue";
import ReportPagination from "../ReportPagination.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); document.body.replaceChildren(); });
function toolbar() {
  const wrapper = mount(ReportToolbar, { attachTo: document.body, props: {
    pageCount: 3, currentPage: 1, zoomMode: "fit", zoom: 1, showExport: true,
    showPrint: true, showPdfWindow: true, messages: DEFAULT_MESSAGES,
    search: { visible: false, query: "", matchIndex: 0, matchCount: 0 }, thumbsVisible: false
  } }); wrappers.push(wrapper); return wrapper;
}
function navigation(columnCount = 3) {
  const columns = Array.from({ length: columnCount }, (_, index) => ({ field: `metric_${index}`, header: `指标 ${index}` }));
  const plan = paginateTemplate(createTableTemplate({ title: "钢种统计", columns }), { detail: [] }).plan;
  const wrapper = mount(ReportNavigation, { attachTo: document.body, props: { sections: [], currentPage: 1, messages: DEFAULT_MESSAGES, busy: false, plan } });
  wrappers.push(wrapper); return wrapper;
}

describe("polished toolbar controls", () => {
  it("keeps all output formats in one keyboard accessible menu, including legacy Word format", async () => {
    const wrapper = toolbar();
    expect(wrapper.find(".mrp-pageinfo").exists()).toBe(false);
    expect(wrapper.find("[role=menu]").exists()).toBe(false);
    const trigger = wrapper.find(".mrp-export-trigger");
    await trigger.trigger("keydown", { key: "ArrowDown" });
    const items = wrapper.findAll("[role=menuitem]");
    expect(items.map((item) => item.text())).toEqual(["导出 Excel.xlsx", "导出 PDF.pdf", "导出图片.png", "导出 Word.doc", "导出 HTML.html"]);
    expect(document.activeElement).toBe(items[0]!.element);
    await items[0]!.trigger("keydown", { key: "End" });
    expect(document.activeElement).toBe(items[4]!.element);
    await items[4]!.trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]!.element);
    await items[3]!.trigger("click");
    expect(wrapper.emitted("export")).toEqual([["word"]]);
    expect(wrapper.find("[role=menu]").exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
  });
  it("respects the format allowlist, outside focus and busy state without losing the trigger", async () => {
    const wrapper = toolbar();
    await wrapper.setProps({ exportFormats: ["xlsx"] });
    await wrapper.find(".mrp-export-trigger").trigger("click");
    expect(wrapper.findAll("[role=menuitem]")).toHaveLength(1);
    const outside = document.createElement("button"); document.body.append(outside); outside.focus();
    await nextTick();
    expect(wrapper.find("[role=menu]").exists()).toBe(false);
    expect(document.activeElement).toBe(outside);
    await wrapper.find(".mrp-export-trigger").trigger("click");
    await wrapper.find("[role=menu]").trigger("keydown", { key: "Escape" });
    expect(wrapper.find("[role=menu]").exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.find(".mrp-export-trigger").element);
    await wrapper.find(".mrp-export-trigger").trigger("click");
    await wrapper.setProps({ busy: true });
    expect(wrapper.find("[role=menu]").exists()).toBe(false);
    expect(wrapper.find(".mrp-export-trigger").attributes("disabled")).toBeDefined();
    expect(wrapper.emitted("export")).toBeUndefined();
  });
  it("supports search clear, search progress, IME and existing keyboard navigation", async () => {
    const wrapper = toolbar();
    await wrapper.setProps({ search: { visible: true, query: "钢", matchIndex: 1, matchCount: 4 } });
    await nextTick();
    const input = wrapper.find(".mrp-search-input");
    expect(document.activeElement).toBe(input.element);
    expect(wrapper.find(".mrp-search-count").text()).toBe("2/4");
    await input.trigger("keydown", { key: "Enter", isComposing: true });
    expect(wrapper.emitted("search-nav")).toBeUndefined();
    await input.trigger("keydown", { key: "Enter", shiftKey: true });
    expect(wrapper.emitted("search-nav")).toEqual([[-1]]);
    await wrapper.setProps({ search: { visible: true, query: "钢", matchIndex: 1, matchCount: 4, searching: true } });
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("search-nav")).toHaveLength(1);
    expect(wrapper.find(".mrp-search-count").text()).toBe("搜索中…");
    await wrapper.find('button[aria-label="清除搜索"]').trigger("click");
    expect(wrapper.emitted("search-input")).toEqual([[""]]);
    expect(document.activeElement).toBe(input.element);
    await wrapper.setProps({ search: { visible: true, query: "不存在", matchIndex: 0, matchCount: 0 } });
    expect(wrapper.find(".mrp-search-hint").text()).toBe("没有匹配内容");
    await input.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("search-toggle")).toHaveLength(1);
  });
  it("preserves explicit standalone pagination and grouped zoom actions", async () => {
    const wrapper = toolbar();
    await wrapper.setProps({ showPagination: true });
    expect(wrapper.find(".mrp-pageinfo").text()).toBe("1 / 3");
    await wrapper.find('.mrp-page-buttons button[aria-label="下一页 ›"]').trigger("click");
    expect(wrapper.emitted("goto")).toEqual([[2]]);
    await wrapper.findAll("button").find((button) => button.text() === "150%")!.trigger("click");
    expect(wrapper.emitted("zoom")).toEqual([[150]]);
  });
});

describe("unified field directory", () => {
  it("filters label and machine field, selects exact targets and restores trigger focus", async () => {
    const wrapper = navigation();
    expect(wrapper.find("input").exists()).toBe(false);
    const trigger = wrapper.find(".mrp-directory-trigger");
    await trigger.trigger("click");
    const input = wrapper.find("input");
    expect(document.activeElement).toBe(input.element);
    await input.setValue("metric_2");
    expect(wrapper.findAll(".mrp-column-directory section button")).toHaveLength(1);
    await input.trigger("keydown", { key: "Enter", isComposing: true });
    expect(wrapper.emitted("locate-target")).toBeUndefined();
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("locate-target")?.[0]?.[0]).toMatchObject({ field: "metric_2", label: "指标 2" });
    expect(wrapper.find(".mrp-column-directory").exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
  });
  it("uses arrow navigation, clears filtering and dismisses on escape or outside pointer", async () => {
    const wrapper = navigation();
    const trigger = wrapper.find(".mrp-directory-trigger");
    await trigger.trigger("click");
    const input = wrapper.find("input");
    await input.trigger("keydown", { key: "ArrowDown" });
    expect(wrapper.findAll('[role=option]')[1]!.attributes("aria-selected")).toBe("true");
    await input.trigger("keydown", { key: "ArrowUp" });
    expect(wrapper.findAll('[role=option]')[0]!.attributes("aria-selected")).toBe("true");
    await input.setValue("指标 2");
    expect(wrapper.findAll('[role=option]')).toHaveLength(1);
    await wrapper.find(".mrp-column-clear").trigger("click");
    expect(wrapper.findAll('[role=option]')).toHaveLength(3);
    await input.trigger("keydown", { key: "Escape" });
    expect(wrapper.find(".mrp-column-directory").exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    await trigger.trigger("click");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); await nextTick();
    expect(wrapper.find(".mrp-column-directory").exists()).toBe(false);
  });
  it("bounds rendering for wide reports while searching every logical field", async () => {
    const wrapper = navigation(105);
    await wrapper.find(".mrp-directory-trigger").trigger("click");
    expect(wrapper.findAll('[role=option]')).toHaveLength(100);
    expect(wrapper.find(".mrp-column-help").text()).toContain("105");
    await wrapper.find("input").setValue("metric_104");
    expect(wrapper.findAll('[role=option]')).toHaveLength(1);
    await wrapper.find("input").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("locate-target")?.[0]?.[0]).toMatchObject({ field: "metric_104" });
  });
  it("keeps raw field lookup as an escape hatch, closes and disables during work", async () => {
    const wrapper = mount(ReportNavigation, { props: { sections: [], currentPage: 1, messages: DEFAULT_MESSAGES, busy: false }, attachTo: document.body }); wrappers.push(wrapper);
    await wrapper.find(".mrp-directory-trigger").trigger("click");
    await wrapper.find("input").setValue("custom_source_key");
    await wrapper.find("input").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("locate")).toEqual([["custom_source_key"]]);
    await wrapper.find(".mrp-directory-trigger").trigger("click");
    await wrapper.setProps({ busy: true });
    expect(wrapper.find(".mrp-column-directory").exists()).toBe(false);
    expect(wrapper.find(".mrp-directory-trigger").attributes("disabled")).toBeDefined();
  });
});

describe("footer pagination", () => {
  it("rejects fractional, unsafe and out-of-range page jumps and allows Enter submission", async () => {
    const wrapper = mount(ReportPagination, { props: { pageCount: 12, currentPage: 1, messages: DEFAULT_MESSAGES } }); wrappers.push(wrapper);
    expect(wrapper.attributes("role")).toBe("navigation");
    expect(wrapper.attributes("aria-label")).toBe("报表分页");
    for (const value of ["0", "13", "1.5", "1e1", "9007199254740992"]) {
      await wrapper.find("input").setValue(value); await wrapper.find("form").trigger("submit");
      expect(wrapper.find("[role=alert]").exists()).toBe(true);
    }
    expect(wrapper.emitted("goto")).toBeUndefined();
    await wrapper.find("input").setValue("12"); await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("goto")).toEqual([[12]]);
    await wrapper.setProps({ currentPage: 12 });
    expect(wrapper.find(".mrp-pageinfo").text()).toBe("12 / 12");
    expect(wrapper.find(".mrp-page-buttons button:last-child").attributes("disabled")).toBeDefined();
    await wrapper.setProps({ busy: true });
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("goto")).toHaveLength(1);
  });
});
