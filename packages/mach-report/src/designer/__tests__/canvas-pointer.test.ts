import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useCanvasPointer } from "../useCanvasPointer";
import type { PlanComponent } from "../../index";
function fixture(disabled = false, resize = false, kind: "text" | "qrcode" = "text") {
  const commit = vi.fn(),
    component: PlanComponent = {
      kind,
      leftMm: 10,
      topMm: 10,
      widthMm: 20,
      heightMm: kind === "qrcode" ? 20 : 10,
      text: "Text",
    };
  const wrapper = mount(
    defineComponent({
      setup() {
        const pointer = useCanvasPointer({
          scale: ref(2),
          disabled: () => disabled,
          page: () => ({
            widthMm: 100,
            heightMm: 100,
            components: [component],
          }),
          commit,
        });
        return () =>
          h("div", {
            "data-canvas-component": "0",
            style:
              "position:absolute;left:20px;top:20px;width:40px;height:20px",
            onPointerdown: (event: PointerEvent) =>
              pointer.start(event, component, resize),
          });
      },
    }),
  );
  const down = () =>
    wrapper.element.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 20, clientY: 20 }),
    );
  return { wrapper, component, commit, down };
}
describe("画布热交互", () => {
  it("二维码角点横向缩放保持正方形且只在结束提交", () => {
    const { wrapper, commit, down } = fixture(false, true, "qrcode");
    down(); window.dispatchEvent(new PointerEvent("pointermove", { clientX: 40, clientY: 20 }));
    expect(commit).not.toHaveBeenCalled(); window.dispatchEvent(new PointerEvent("pointerup"));
    expect(commit).toHaveBeenCalledExactlyOnceWith({ leftMm: 10, topMm: 10, widthMm: 30, heightMm: 30 });
    wrapper.unmount();
  });
  it("连续100次pointermove只在结束时提交一笔，不修改原始模板", () => {
    const { wrapper, component, commit, down } = fixture();
    down();
    for (let index = 1; index <= 100; index++)
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 20 + index, clientY: 40 }),
      );
    expect(commit).not.toHaveBeenCalled();
    expect(component.leftMm).toBe(10);
    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(commit).toHaveBeenCalledExactlyOnceWith({
      leftMm: 60,
      topMm: 20,
      widthMm: 20,
      heightMm: 10,
    });
    wrapper.unmount();
  });
  it("Escape和卸载取消拖动，迟到pointerup不提交；只读不开始", () => {
    const first = fixture();
    first.down();
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 90, clientY: 40 }),
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(first.commit).not.toHaveBeenCalled();
    expect((first.wrapper.element as HTMLElement).style.left).toBe("20px");
    first.down();
    first.wrapper.unmount();
    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(first.commit).not.toHaveBeenCalled();
    const readonly = fixture(true);
    readonly.down();
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 90, clientY: 40 }),
    );
    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(readonly.commit).not.toHaveBeenCalled();
    readonly.wrapper.unmount();
  });
  it("越界拖动被钳制到页面内", () => {
    const { wrapper, commit, down } = fixture();
    down();
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 999, clientY: -999 }),
    );
    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(commit).toHaveBeenCalledExactlyOnceWith({
      leftMm: 80,
      topMm: 0,
      widthMm: 20,
      heightMm: 10,
    });
    wrapper.unmount();
  });
});
