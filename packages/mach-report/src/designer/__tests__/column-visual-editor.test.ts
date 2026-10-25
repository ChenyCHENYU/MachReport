import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ColumnVisualEditor from "../ColumnVisualEditor.vue";
describe("visual metric column controls", () => {
  it("enables rules, rejects reversed domains, switches visual type and explicitly disables", async () => {
    const wrapper = mount(ColumnVisualEditor, { props: { fields: [{ field: "weight", label: "Weight" }] } });
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([{ kind: "colorScale", numeric: "number", lowColor: "#f0f7ff", highColor: "#8bbcf1" }]);
    await wrapper.findAll("select")[1]!.setValue("weight");
    await wrapper.findAll('input[type="number"]')[0]!.setValue("20");
    const before = wrapper.emitted("update:modelValue")!.length;
    await wrapper.findAll('input[type="number"]')[1]!.setValue("10"); expect(wrapper.get('[role="status"]').text()).toContain("最小值"); expect(wrapper.emitted("update:modelValue")).toHaveLength(before + 1); expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([expect.objectContaining({ min: 20, max: 10 })]);
    await wrapper.findAll('input[type="number"]')[1]!.setValue("30");
    await wrapper.findAll("select")[0]!.setValue("dataBar");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([{ kind: "dataBar", numeric: "number", field: "weight", min: 20, max: 30, color: "#bad8fa", negativeColor: "#f3bcc3" }]);
    expect(wrapper.text()).toContain("静态视觉");
    await wrapper.get('input[type="checkbox"]').setValue(false); expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([undefined]); wrapper.unmount();
  });
  it("reflects controlled changes and protects readonly state", async () => {
    const wrapper = mount(ColumnVisualEditor, { props: { modelValue: { kind: "dataBar", min: 0, max: 1 }, readonly: true } });
    expect(wrapper.get('input[type="checkbox"]').attributes("disabled")).toBeDefined();
    await wrapper.findAll('input[type="number"]')[0]!.setValue("2"); expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await wrapper.setProps({ modelValue: undefined }); expect(wrapper.find('select').exists()).toBe(false); wrapper.unmount();
  });
});
