// @vitest-environment happy-dom
import { effectScope, shallowRef } from "vue";
import { expect, it, vi } from "vitest";
import { usePageWindow } from "../composables/usePageWindow";
import type { RenderPlan } from "../../schema/render-plan";

it("keeps an explicitly selected short page at a clamped scroll offset until the user scrolls", () => {
  let frame: FrameRequestCallback | undefined;
  const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => { frame = callback; return 1; });
  const cancel = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
  const scope = effectScope();
  try {
    const plan = shallowRef<RenderPlan | null>({ schemaVersion: "1", pages: Array.from({ length: 4 }, () => ({ pageWidthMm: 80, pageHeightMm: 55, components: [] })) });
    const zoom = shallowRef(1), current = shallowRef(1);
    const window = scope.run(() => usePageWindow(plan, zoom))!;
    let top = 0;
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "scrollTop", { get: () => top, set: value => { top = Math.min(300, value); } });
    Object.defineProperty(viewport, "clientHeight", { value: 600 });
    const scroll = window.makeScrollHandler(current, shallowRef(4));
    window.scrollToPage(viewport, 2);
    scroll(viewport); frame!(0);
    expect(top).toBe(300);
    expect(current.value).toBe(3);
    top = 280; scroll(viewport); frame!(0);
    expect(current.value).toBe(2);
    window.scrollToPage(viewport, 3); scroll(viewport); frame!(0);
    expect(current.value).toBe(4);
    // A zoom or new report invalidates the navigation marker.
    zoom.value = 2; scroll(viewport); frame!(0);
    expect(current.value).toBe(1);
    window.scrollToPage(viewport, 3);
    plan.value = { ...plan.value!, pages: plan.value!.pages.slice() };
    scroll(viewport); frame!(0);
    expect(current.value).toBe(1);
  } finally { scope.stop(); raf.mockRestore(); cancel.mockRestore(); }
});
