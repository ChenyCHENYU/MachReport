/* eslint-disable vue/one-component-per-file -- Inline components exercise separate provide/inject scopes. */
import { afterEach, expect, it } from "vitest";
import { computed, defineComponent, h, nextTick, reactive, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineMachReportConfig, machReportPlugin, provideMachReportConfig, type MachReportTheme } from "../../vue/index";
import ReportPreview from "../../vue/ReportPreview.vue";
import { useDesignerTheme } from "../useDesignerTheme";

const wrappers: VueWrapper[] = [];
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); });
function value(wrapper: VueWrapper, selector: string, name: string): string {
  return (wrapper.get(selector).element as HTMLElement).style.getPropertyValue(name);
}
const appConfig = () => defineMachReportConfig({
  defaults: { theme: { shellBg: "#101010", toolbarFg: "#111111", btnFg: "#121212" } },
  presets: { invoice: { theme: { shellBg: "#202020", toolbarBg: "#212121", btnActiveBg: "#222222" } } },
  defaultPreset: "invoice"
});
it("uses the same reactive app/preset/route/preview precedence for the shell and its nested preview", async () => {
  const override = ref<Partial<MachReportTheme>>({ btnActiveBg: "#414141", toolbarFg: "#424242" });
  const route = reactive({ defaults: { theme: { shellBg: "#303030", btnFg: "#313131" } }, presets: { invoice: { theme: { toolbarBg: "#323232" } } } });
  const Designer = defineComponent({ setup() {
    const theme = useDesignerTheme(() => override.value);
    provideMachReportConfig({ get defaults() { return { theme: override.value }; } });
    return () => h("section", { class: "theme-designer", style: theme.value }, [h(ReportPreview, { autoLoad: false, height: "100px", showExport: false, showPrint: false, showPdfWindow: false })]);
  } });
  const Route = defineComponent({ setup() { provideMachReportConfig(route); return () => h(Designer); } });
  const wrapper = mount(Route, { global: { plugins: [[machReportPlugin, { config: appConfig(), globalComponent: false }]] } }); wrappers.push(wrapper);
  for (const selector of [".theme-designer", ".mach-report-preview"]) {
    expect(value(wrapper, selector, "--mrp-shell-bg")).toBe("#303030");
    expect(value(wrapper, selector, "--mrp-toolbar-bg")).toBe("#323232");
    expect(value(wrapper, selector, "--mrp-btn-active-bg")).toBe("#414141");
    expect(value(wrapper, selector, "--mrp-toolbar-fg")).toBe("#424242");
  }
  route.defaults.theme.shellBg = "#505050"; override.value = { btnActiveBg: "#616161" }; await nextTick();
  for (const selector of [".theme-designer", ".mach-report-preview"]) {
    expect(value(wrapper, selector, "--mrp-shell-bg")).toBe("#505050");
    expect(value(wrapper, selector, "--mrp-toolbar-fg")).toBe("#111111");
    expect(value(wrapper, selector, "--mrp-btn-active-bg")).toBe("#616161");
  }
});
it("setup reads the parent provider while descendants receive the new local provider", () => {
  const Child = defineComponent({ setup() { const theme = useDesignerTheme(); return () => h("div", { class: "theme-child", style: theme.value }); } });
  const Parent = defineComponent({ setup() {
    provideMachReportConfig({ theme: { shellBg: "#abcdef" } });
    const theme = useDesignerTheme();
    return () => h("section", { class: "theme-parent", style: theme.value }, [h(Child)]);
  } });
  const wrapper = mount(Parent, { global: { plugins: [[machReportPlugin, { config: appConfig(), globalComponent: false }]] } }); wrappers.push(wrapper);
  expect(value(wrapper, ".theme-parent", "--mrp-shell-bg")).toBe("#202020");
  expect(value(wrapper, ".theme-child", "--mrp-shell-bg")).toBe("#abcdef");
});
it("accepts the stable public injection key and keeps independent sibling theme scopes", () => {
  const Probe = defineComponent({ setup() { const theme = useDesignerTheme(); return () => h("div", { class: "theme-probe", style: theme.value }); } });
  const Local = defineComponent({ setup() { provideMachReportConfig({ theme: { shellBg: "#abcdef" } }); return () => h("section", { class: "theme-local" }, [h(Probe)]); } });
  const Host = defineComponent({ setup() { return () => h("main", [h(Local), h("aside", { class: "theme-sibling" }, [h(Probe)])]); } });
  const wrapper = mount(Host, { global: { provide: { "mach-report/config": computed(() => appConfig()) } } }); wrappers.push(wrapper);
  expect(value(wrapper, ".theme-local .theme-probe", "--mrp-shell-bg")).toBe("#abcdef");
  expect(value(wrapper, ".theme-sibling .theme-probe", "--mrp-shell-bg")).toBe("#202020");
});
