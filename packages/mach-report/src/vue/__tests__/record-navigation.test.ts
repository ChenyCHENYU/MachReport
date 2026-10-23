// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createLabelTemplate, paginateTemplate, type RenderPlan } from "../../index";
import { DEFAULT_MESSAGES } from "../config";
import { indexRecordNavigation } from "../record-navigation";
import ReportRecordNavigation from "../ReportRecordNavigation.vue";
import ReportNavigation from "../ReportNavigation.vue";

let wrapper: VueWrapper | undefined;
afterEach(() => { wrapper?.unmount(); wrapper = undefined; });
function labels(): RenderPlan {
  return paginateTemplate(createLabelTemplate({ dataset: "items", rowKey: "id", copies: 2, pages: [
    { meta: { title: "产品标识" }, components: [] }, { meta: { title: "仓储识别" }, components: [] }
  ] }), { items: [{ id: "00001" }, { id: "00002" }] }).plan;
}
describe("contextual label navigation", () => {
  it("indexes records once across faces and copies, including merged label sources", () => {
    const plan = labels();
    expect(indexRecordNavigation(plan)).toEqual({ entries: [{ page: 1, rowKey: "00001" }, { page: 5, rowKey: "00002" }], pageRecords: [0, 0, 0, 0, 1, 1, 1, 1] });
    plan.pages.push(...labels().pages);
    expect(indexRecordNavigation(plan).entries).toHaveLength(4);
    expect(indexRecordNavigation(null).entries).toEqual([]);
  });
  it("moves to adjacent records rather than faces and keeps physical pagination separate", async () => {
    wrapper = mount(ReportRecordNavigation, { props: { plan: labels(), currentPage: 2, busy: false, messages: DEFAULT_MESSAGES } });
    expect(wrapper.text()).toContain("记录 1 / 2");
    expect(wrapper.text()).toContain("00001");
    expect(wrapper.text()).toContain("仓储识别");
    expect(wrapper.find('button[aria-label="上一条记录"]').attributes("disabled")).toBeDefined();
    await wrapper.find('button[aria-label="下一条记录"]').trigger("click");
    expect(wrapper.emitted("goto")).toEqual([[5]]);
    await wrapper.setProps({ currentPage: 8, busy: true });
    expect(wrapper.text()).toContain("记录 2 / 2");
    expect(wrapper.findAll("button").every(button => button.attributes("disabled") !== undefined)).toBe(true);
    await wrapper.setProps({ currentPage: 5, busy: false, messages: { ...DEFAULT_MESSAGES, recordInfo: "Item {cur} of {total}", prevRecord: "Previous item" } });
    await wrapper.find('button[aria-label="Previous item"]').trigger("click");
    expect(wrapper.emitted("goto")?.[1]).toEqual([1]);
    expect(wrapper.text()).toContain("Item 2 of 2");
  });
  it("ignores ordinary and malformed pages, and reindexes replacement plans", async () => {
    const plan = labels();
    plan.pages[0]!.meta = { record: { dataset: "items", rowIndex: -1 } };
    expect(indexRecordNavigation(plan).pageRecords[0]).toBe(-1);
    wrapper = mount(ReportRecordNavigation, { props: { plan: null, currentPage: 1, busy: false, messages: DEFAULT_MESSAGES } });
    expect(wrapper.find("nav").exists()).toBe(false);
    await wrapper.setProps({ plan: labels() });
    expect(wrapper.text()).toContain("00001");
    await wrapper.setProps({ plan: { schemaVersion: "1", pages: [] } });
    expect(wrapper.find("nav").exists()).toBe(false);
  });
  it("does not offer an empty column catalogue for fixed labels", () => {
    wrapper = mount(ReportNavigation, { props: { plan: labels(), currentPage: 1, sections: [], busy: false, messages: DEFAULT_MESSAGES } });
    expect(wrapper.find("nav").exists()).toBe(false);
  });
});
