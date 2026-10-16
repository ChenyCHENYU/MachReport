import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ReportDiagnostics from "../ReportDiagnostics.vue";
import { DEFAULT_MESSAGES } from "../config";

describe("visible diagnostic search", () => {
  it("matches translated content, displayed positions, format and technical paths", async () => {
    const wrapper = mount(ReportDiagnostics, { props: { messages: DEFAULT_MESSAGES, entries: [
      { code: "missing-image", severity: "warning", message: "Image data is missing", format: "canvas", pageIndex: 1, componentIndex: 3 },
      { code: "unsupported-component", severity: "warning", message: "Unsupported geometry", format: "xlsx", pageIndex: 0, componentIndex: 0, path: "source.qty" }
    ] } });
    const input = wrapper.find('input[type="search"]');
    await input.setValue("尚未准备");
    expect(wrapper.findAll("li")).toHaveLength(1); expect(wrapper.find("li").text()).toContain("missing-image");
    await input.setValue("第 2 页");
    expect(wrapper.findAll("li")).toHaveLength(1); expect(wrapper.find("li").text()).toContain("组件 4");
    await input.setValue("XLSX");
    expect(wrapper.findAll("li")).toHaveLength(1); expect(wrapper.find("li").text()).toContain("unsupported-component");
    await input.setValue("source.qty"); expect(wrapper.findAll("li")).toHaveLength(1);
    await input.setValue("not a diagnostic"); expect(wrapper.findAll("li")).toHaveLength(0);
    wrapper.unmount();
  });
});
