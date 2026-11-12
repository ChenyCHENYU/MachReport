import { mount } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { useFieldSelectPopup } from "../useFieldSelectPopup";

const deferred = vi.hoisted(() => ({ ticks: [] as Array<() => void> }));
vi.mock("vue", async original => ({
  ...await original<typeof import("vue")>(),
  nextTick: () => new Promise<void>(resolve => deferred.ticks.push(resolve)),
}));
const actual = await vi.importActual<typeof import("vue")>("vue");
afterEach(() => { deferred.ticks.splice(0).forEach(resolve => resolve()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("a delayed open cannot resurrect observers after close/reopen or unmount", async () => {
  const created: object[] = [], observers = new Set<object>();
  vi.stubGlobal("ResizeObserver", class {
    constructor() { created.push(this); observers.add(this); }
    observe(): void { /* Geometry delivery is irrelevant to the lifecycle fence. */ }
    disconnect(): void { observers.delete(this); }
  });
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const originalAdd = window.addEventListener, originalRemove = window.removeEventListener;
  vi.spyOn(window, "addEventListener").mockImplementation((name, listener, options) => {
    if ((name === "resize" || name === "scroll") && listener) {
      const entries = listeners.get(name) ?? new Set(); entries.add(listener); listeners.set(name, entries);
    }
    Reflect.apply(originalAdd, window, [name, listener, options]);
  });
  vi.spyOn(window, "removeEventListener").mockImplementation((name, listener, options) => {
    if (listener) listeners.get(name)?.delete(listener);
    Reflect.apply(originalRemove, window, [name, listener, options]);
  });
  const open = ref(false);
  const wrapper = mount(defineComponent({ setup() {
    const input = ref<HTMLInputElement>(), options = ref<HTMLElement>();
    useFieldSelectPopup(input, options, open);
    return () => h("div", [h("input", { ref: input }), h("div", { ref: options })]);
  } }));
  open.value = true; await actual.nextTick();
  expect(deferred.ticks).toHaveLength(1);
  open.value = false; await actual.nextTick();
  open.value = true; await actual.nextTick();
  expect(deferred.ticks).toHaveLength(2);
  deferred.ticks.shift()!(); await Promise.resolve();
  expect(created).toHaveLength(0);
  deferred.ticks.shift()!(); await Promise.resolve();
  expect(created).toHaveLength(1); expect(observers.size).toBe(1);
  expect(listeners.get("resize")?.size).toBe(1); expect(listeners.get("scroll")?.size).toBe(1);
  // A third pending expansion must remain inert even if its component disappears.
  open.value = false; await actual.nextTick();
  open.value = true; await actual.nextTick();
  wrapper.unmount();
  deferred.ticks.splice(0).forEach(resolve => resolve()); await Promise.resolve();
  expect(created).toHaveLength(1); expect(observers.size).toBe(0);
  expect(listeners.get("resize")?.size).toBe(0); expect(listeners.get("scroll")?.size).toBe(0);
});
