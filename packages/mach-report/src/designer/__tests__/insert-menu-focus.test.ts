import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import DesignerInsertMenu from "../DesignerInsertMenu.vue";

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.replaceChildren(); });

async function menu() {
  const wrapper = mount(DesignerInsertMenu, {
    attachTo: document.body,
    props: { fields: [{ field: "grade", label: "钢种", type: "text" }, { field: "energy", label: "总用电量", type: "number" }] },
  });
  wrappers.push(wrapper);
  await wrapper.get(".mr-insert-trigger").trigger("click");
  await wrapper.get(".mr-insert-field").trigger("click");
  await flushPromises();
  return wrapper;
}

describe("insert menu pointer and keyboard focus", () => {
  it("focuses each checkbox before native activation, retaining both changes when clicks do not focus controls", async () => {
    const wrapper = await menu();
    for (const name of ["钢种", "总用电量"]) {
      const checkbox = wrapper.get(`input[aria-label="选择字段 ${name}"]`);
      const pointer = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
      checkbox.element.dispatchEvent(pointer);
      expect(document.activeElement).toBe(checkbox.element);
      expect(pointer.defaultPrevented).toBe(false);
      (checkbox.element as HTMLInputElement).click();
      await flushPromises();
      expect((checkbox.element as HTMLInputElement).checked).toBe(true);
    }
    expect(wrapper.get(".mr-insert-batch").text()).toContain("已选 2 项");
    await wrapper.get(".mr-insert-batch button").trigger("click");
    expect(wrapper.emitted("fields")?.[0]).toEqual([["grade", "energy"]]);
  });

  it("keeps focus inside blank menu content while normal keyboard departure dismisses and preserves outside focus", async () => {
    const wrapper = await menu();
    await wrapper.get(".mr-insert-panel header strong").trigger("pointerdown", { button: 0 });
    expect(document.activeElement).toBe(wrapper.get(".mr-insert-panel").element);
    const outside = document.createElement("button"); document.body.append(outside);
    outside.focus(); await flushPromises();
    expect(wrapper.find(".mr-insert-panel").exists()).toBe(false);
    expect(document.activeElement).toBe(outside);
  });

  it("Escape returns focus to the trigger and disabled controls retain the open dialog without activation", async () => {
    const wrapper = await menu();
    await wrapper.setProps({ columns: true, usedFields: ["grade"] });
    const disabled = wrapper.get('input[aria-label="选择字段 钢种"]');
    disabled.element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(document.activeElement).toBe(wrapper.get(".mr-insert-panel").element);
    expect((disabled.element as HTMLInputElement).checked).toBe(false);
    await wrapper.get(".mr-insert-panel").trigger("keydown", { key: "Escape" });
    expect(wrapper.find(".mr-insert-panel").exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.get(".mr-insert-trigger").element);
    expect(wrapper.emitted("field")).toBeUndefined();
  });
  it("reopens from a trigger click that does not natively focus the button", async () => {
    const wrapper = await menu();
    await wrapper.get(".mr-insert-panel").trigger("keydown", { key: "Escape" });
    const trigger = wrapper.get(".mr-insert-trigger");
    (trigger.element as HTMLButtonElement).blur();
    trigger.element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(document.activeElement).toBe(trigger.element);
    // WebKit's native mousedown blurs a programmatically focused button.
    (trigger.element as HTMLButtonElement).blur();
    (trigger.element as HTMLButtonElement).click(); await flushPromises();
    expect(wrapper.find(".mr-insert-panel").exists()).toBe(true);
    expect(document.activeElement).toBe(trigger.element);
  });
  it("does not steal focus from a confirmation when the activated item unmounts before click bubbles", async () => {
    const wrapper = await menu();
    const item = wrapper.get(".mr-insert-fields button").element;
    (item as HTMLButtonElement).click(); await flushPromises();
    const confirmation = document.createElement("button"); document.body.append(confirmation); confirmation.focus();
    const click = new MouseEvent("click", { bubbles: true, button: 0 });
    Object.defineProperty(click, "target", { value: item });
    wrapper.element.dispatchEvent(click);
    expect(document.activeElement).toBe(confirmation);
  });
});
