import { mount } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import FieldSelect from "../FieldSelect.vue";
import { fieldPopupPlacement } from "../useFieldSelectPopup";

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });
it("prefers the space within all clipping ancestors and bounds the internal option viewport", () => {
  expect(fieldPopupPlacement({ top: 609, bottom: 640 }, { top: 116, bottom: 639.5 })).toEqual({ above: true, optionsHeight: 230 });
  expect(fieldPopupPlacement({ top: 150, bottom: 181 }, { top: 116, bottom: 639.5 })).toEqual({ above: false, optionsHeight: 230 });
  expect(fieldPopupPlacement({ top: 300, bottom: 331 }, { top: 116, bottom: 340 })).toEqual({ above: true, optionsHeight: 144 });
});
it("flips a focused field above its fractional scroll clip and updates after resize", async () => {
  const host = document.createElement("div"); host.style.overflow = "hidden"; document.body.append(host);
  const wrapper = mount(FieldSelect, { props: { modelValue: "f0", fields: [{ field: "f0", type: "text" }], label: "字段" }, attachTo: host });
  let bottom = 640, anchorTop = 609;
  Object.defineProperty(host, "clientHeight", { get: () => Math.round(bottom - 116), configurable: true });
  vi.spyOn(host, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 116, 300, bottom - 116));
  const input = wrapper.get("input");
  vi.spyOn(input.element, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, anchorTop, 265, 31));
  await input.trigger("focus"); await Promise.resolve();
  await vi.waitFor(() => expect(wrapper.get(".mr-field-popup").classes()).toContain("is-above"));
  bottom = 1000; anchorTop = 200;
  window.dispatchEvent(new Event("resize"));
  await vi.waitFor(() => expect(wrapper.get(".mr-field-popup").classes()).not.toContain("is-above"));
  const removed = vi.spyOn(window, "removeEventListener");
  wrapper.unmount();
  expect(removed.mock.calls.some(([name]) => name === "resize")).toBe(true);
  expect(removed.mock.calls.some(([name]) => name === "scroll")).toBe(true);
});
