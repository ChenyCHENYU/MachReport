import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, expect, it } from "vitest";
import { createTableTemplate, defineReportTemplate } from "../../index";
import { machReportPlugin } from "../../vue/plugin";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";
import ReportLabelStudio from "../ReportLabelStudio.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount(); });
const theme = { colorScheme: "dark", toolbarBg: "#172235", toolbarFg: "#e2e8f0", btnActiveBg: "#93c5fd", btnActiveFg: "#0b1220" } as const;
const pluginOptions = { config: { defaults: { theme } }, globalComponent: false };
const plugins: [typeof machReportPlugin, typeof pluginOptions][] = [[machReportPlugin, pluginOptions]];
const global = { plugins };
const template = createTableTemplate({ columns: [{ header: "编号", field: "id" }] });
const modelValue = defineReportTemplate({ id: "theme", name: "主题回归", template });

it("真实编辑器外壳和内嵌预览共享应用主题，本地覆盖可清除并恢复继承", async () => {
  const wrapper = mount(ReportTemplateEditor, { props: { modelValue, datasets: { detail: [{ id: "001" }] } }, global });
  wrappers.push(wrapper);
  await flushPromises();
  for (const selector of [".mr-designer", ".mach-report-preview"]) {
    expect((wrapper.get(selector).element as HTMLElement).style.getPropertyValue("--mrp-toolbar-bg")).toBe(theme.toolbarBg);
    expect((wrapper.get(selector).element as HTMLElement).style.getPropertyValue("--mrp-btn-active-fg")).toBe(theme.btnActiveFg);
  }
  await wrapper.setProps({ preview: { theme: { toolbarBg: "#24364f" } } });
  for (const selector of [".mr-designer", ".mach-report-preview"]) {
    expect((wrapper.get(selector).element as HTMLElement).style.getPropertyValue("--mrp-toolbar-bg")).toBe("#24364f");
  }
  await wrapper.setProps({ preview: undefined });
  expect((wrapper.element as HTMLElement).style.getPropertyValue("--mrp-toolbar-bg")).toBe(theme.toolbarBg);
  expect((wrapper.get(".mach-report-preview").element as HTMLElement).style.getPropertyValue("--mrp-toolbar-bg")).toBe(theme.toolbarBg);
});

it("标签工作台使用同一配置，传入记录和字段契约即可保持预览主题一致", async () => {
  const wrapper = mount(ReportLabelStudio, { props: { rows: [{ id: "001" }], schema: { rowKey: "id", fields: [{ field: "id", type: "text" }] } }, global });
  wrappers.push(wrapper);
  await flushPromises();
  for (const selector of [".mr-label-studio", ".mach-report-preview"]) {
    const style = (wrapper.get(selector).element as HTMLElement).style;
    expect(style.getPropertyValue("--mrp-toolbar-bg")).toBe(theme.toolbarBg);
    expect(style.getPropertyValue("--mrp-toolbar-fg")).toBe(theme.toolbarFg);
  }
  await wrapper.setProps({ preview: { theme: { btnActiveBg: "#ffca85", btnActiveFg: "#251802" } } });
  for (const selector of [".mr-label-studio", ".mach-report-preview"]) {
    const style = (wrapper.get(selector).element as HTMLElement).style;
    expect(style.getPropertyValue("--mrp-btn-active-bg")).toBe("#ffca85");
    expect(style.getPropertyValue("--mrp-btn-active-fg")).toBe("#251802");
  }
});
