import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import ReportDataReviewDialog from "../ReportDataReviewDialog.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => { wrappers.reverse().forEach(wrapper => wrapper.unmount()); wrappers.length = 0; document.body.replaceChildren(); });
function mountDialog(title = "Data review") {
  const wrapper = mount(ReportDataReviewDialog, {
    props: { title, closeLabel: `Close ${title}` },
    slots: { default: '<input aria-label="Filter" /><button type="button" hidden>Hidden</button><textarea aria-label="Notes"></textarea><a href="#target">Details</a>' },
    attachTo: document.body
  });
  wrappers.push(wrapper); return wrapper;
}
function key(target: EventTarget, value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event); return event;
}

describe("review dialog keyboard ownership", () => {
  it("closes only the focused dialog when two independent previews have open reviews", () => {
    const first = mountDialog("First"), second = mountDialog("Second");
    (second.get("input").element as HTMLInputElement).focus();
    const event = key(second.get("input").element, "Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(first.emitted("close")).toBeUndefined();
    expect(second.emitted("close")).toHaveLength(1);
  });

  it("traps Tab inside the focused dialog including textarea and link endpoints", () => {
    const first = mountDialog("First"), second = mountDialog("Second");
    const close = second.get("header button").element as HTMLButtonElement;
    const last = second.get("a").element as HTMLAnchorElement;
    close.focus(); expect(key(close, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    expect(key(last, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    const textarea = second.get("textarea").element as HTMLTextAreaElement;
    textarea.focus(); expect(key(textarea, "Tab").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(textarea);
    expect(first.emitted("close")).toBeUndefined();
  });

  it("recovers a sole dialog's lost focus without consuming Escape or Tab owned by another modal", () => {
    const wrapper = mountDialog();
    (document.activeElement as HTMLElement).blur();
    expect(key(document, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(wrapper.get("header button").element);
    const other = document.createElement("dialog"); other.open = true;
    const input = document.createElement("input"); other.append(input); document.body.append(other); input.focus();
    expect(key(input, "Escape").defaultPrevented).toBe(false);
    expect(wrapper.emitted("close")).toBeUndefined();
    input.blur(); expect(key(document, "Tab").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(document.body);
    other.remove(); expect(key(document, "Escape").defaultPrevented).toBe(true);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("lets a nested alert dialog own its keyboard and ignores composition and handled keys", () => {
    const wrapper = mountDialog();
    const nested = document.createElement("section"); nested.setAttribute("role", "alertdialog"); nested.setAttribute("aria-modal", "true");
    const input = document.createElement("input"); nested.append(input); wrapper.get("section").element.append(nested); input.focus();
    expect(key(input, "Escape").defaultPrevented).toBe(false);
    expect(key(input, "Tab", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(wrapper.emitted("close")).toBeUndefined(); nested.remove();
    const close = wrapper.get("header button").element as HTMLButtonElement; close.focus();
    expect(key(close, "Escape", { isComposing: true }).defaultPrevented).toBe(false);
    expect(key(close, "Escape", { keyCode: 229 }).defaultPrevented).toBe(false);
    const handled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }); handled.preventDefault(); close.dispatchEvent(handled);
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("does not restore a removed background dialog's opener over another preview's focus", () => {
    const opener = document.createElement("button"); document.body.append(opener); opener.focus();
    const first = mountDialog("First"), second = mountDialog("Second");
    const input = second.get("input").element as HTMLInputElement; input.focus();
    first.unmount(); expect(document.activeElement).toBe(input);
    expect(second.emitted("close")).toBeUndefined();
  });

  it("returns from a nested review to its still-open parent and removes its listener", () => {
    const first = mountDialog("First");
    const opener = first.get("header button").element as HTMLButtonElement; opener.focus();
    const second = mountDialog("Second"); second.unmount();
    expect(document.activeElement).toBe(opener);
    const event = key(opener, "Escape"); expect(event.defaultPrevented).toBe(true);
    expect(first.emitted("close")).toHaveLength(1);
    expect(second.emitted("close")).toBeUndefined();
  });

  it("returns an actively closed independent review to its own trigger while another review remains open", async () => {
    const first = mountDialog("First");
    const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
    const visible = ref(true);
    const second = mount(defineComponent({ setup: () => () => visible.value ? h(ReportDataReviewDialog, { title: "Second", closeLabel: "Close Second" }) : null }), { attachTo: document.body });
    wrappers.push(second);
    expect(document.activeElement).toBe(second.get("header button").element);
    // Match ReportPreview's v-if close; unmounting the entire Test Utils app
    // detaches its container before Vue's component hooks run.
    visible.value = false; await nextTick();
    expect(document.activeElement).toBe(trigger);
    expect(first.emitted("close")).toBeUndefined();
    expect(key(trigger, "Escape").defaultPrevented).toBe(false);
    expect(first.emitted("close")).toBeUndefined();
  });

  it("restores the opener after ordinary close but leaves a remaining unrelated modal in control", () => {
    const opener = document.createElement("button"); document.body.append(opener); opener.focus();
    const first = mountDialog(); first.unmount(); expect(document.activeElement).toBe(opener);
    const next = mountDialog();
    const other = document.createElement("section"); other.setAttribute("role", "dialog"); other.setAttribute("aria-modal", "true"); document.body.append(other);
    (document.activeElement as HTMLElement).blur(); next.unmount();
    expect(document.activeElement).toBe(document.body);
    const event = key(document, "Escape"); expect(event.defaultPrevented).toBe(false);
  });
});
