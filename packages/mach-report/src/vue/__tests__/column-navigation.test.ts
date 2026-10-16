import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createTableTemplate, paginateTemplate } from "../../index";
import ReportNavigation from "../ReportNavigation.vue";
import { DEFAULT_MESSAGES } from "../config";

describe("column directory interaction", () => {
  it("searches display names and emits the exact table target while preserving raw field submission", async () => {
    const plan = paginateTemplate(createTableTemplate({ title: "产量", columns: [{ header: "炉号", field: "heat" }, { header: "重量", field: "weight" }] }), { detail: [] }).plan;
    const header = plan.pages[0]!.components.find((component) => component.table?.role === "header")!;
    const other = structuredClone(header); other.table!.id = "second"; other.table!.title = "成本";
    plan.pages[0]!.components.push(other);
    const wrapper = mount(ReportNavigation, { props: { sections: [], plan, messages: DEFAULT_MESSAGES, currentPage: 1, busy: false } });
    await wrapper.find('input[type="search"]').setValue("重量");
    const candidates = wrapper.findAll(".mrp-column-directory section button");
    expect(candidates).toHaveLength(2);
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    candidates[1]!.element.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    await candidates[1]!.trigger("click");
    expect(wrapper.emitted("locate-target")?.[0]?.[0]).toMatchObject({ field: "weight", tableId: "second" });
    expect(wrapper.find(".mrp-column-directory").exists()).toBe(false);
    await wrapper.find('input[type="search"]').setValue("custom_field");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("locate")?.[0]).toEqual(["custom_field"]);
    wrapper.unmount();
  });
});
