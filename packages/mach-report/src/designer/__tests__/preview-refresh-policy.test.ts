import { mount } from "@vue/test-utils";
import { computed, defineComponent, effectScope, h, nextTick, reactive, ref, watch, type PropType } from "vue";
import { expect, it } from "vitest";
import { createTableTemplate, defineReportTemplate } from "../../index";
import ReportLabelStudio from "../ReportLabelStudio.vue";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";
import { useDesignerViews } from "../useDesignerViews";

it("label output state changes do not republish a different refresh policy to its own child", async () => {
  const state = reactive({ printing: false, exporting: null as string | null, canPrint: true });
  let refreshChanges = 0;
  const Preview = defineComponent({ name: "ReportPreview", props: { refresh: { type: Object as PropType<{ retainPrevious: boolean; key: string }>, default: undefined } }, setup(props, { expose }) {
    watch(() => props.refresh, () => { refreshChanges++; });
    expose({ state, reload() {}, print() {}, exportAs() {}, openPdfWindow() {}, gotoPage() {}, setParams() {} });
    return () => h("div");
  } });
  const wrapper = mount(ReportLabelStudio, { props: { rows: [{ id: "a", heat: "001" }], schema: { rowKey: "id", fields: [{ field: "id", type: "text" }, { field: "heat", type: "text" }] } }, global: { stubs: { ReportPreview: Preview } } });
  try {
    await nextTick(); refreshChanges = 0;
    for (let index = 0; index < 3; index++) {
      state.exporting = "pdf"; await nextTick();
      expect(wrapper.get(".mr-label-quick").attributes("disabled")).toBeDefined();
      state.exporting = null; await nextTick();
      expect(wrapper.get(".mr-label-quick").attributes("disabled")).toBeUndefined();
    }
    expect(refreshChanges).toBe(0);
  } finally { wrapper.unmount(); }
});

it("template edits keep the child refresh policy identity while updating the document", async () => {
  const document = defineReportTemplate({ id: "refresh-policy", name: "模板", template: createTableTemplate({ columns: [{ field: "id", header: "编号" }] }) });
  const wrapper = mount(ReportTemplateEditor, { props: { modelValue: document }, global: { stubs: { ReportPreview: true, TemplateDesignCanvas: true } } });
  try {
    const preview = wrapper.getComponent({ name: "ReportPreview" }), policy = preview.props("refresh");
    expect(policy).toEqual({ retainPrevious: true, key: document.id });
    await wrapper.get('[data-mr-control="column-header"]').setValue("新表头");
    expect(preview.props("refresh")).toBe(policy);
    expect(wrapper.get('[data-mr-control="column-header"]').element).toHaveProperty("value", "新表头");
  }
  finally { wrapper.unmount(); }
});

it("same-identity document edits retain policy identity while replacement resets hidden view state", async () => {
  const scope = effectScope(), document = ref({ id: "first" } as ReturnType<typeof defineReportTemplate>), mode = ref<"design" | "preview">("preview");
  const fetcher = computed(() => { const id = document.value.id; return async () => ({ schemaVersion: id, pages: [] }); });
  const views = scope.run(() => useDesignerViews(document, mode, fetcher))!;
  try {
    const first = views.previewRefresh.value;
    expect(first).toEqual({ retainPrevious: true, key: "first" });
    document.value = { ...document.value, name: "Changed" }; await nextTick();
    expect(views.previewRefresh.value).toBe(first);
    const activeFetcher = views.visibleFetcher.value;
    mode.value = "design"; document.value = { ...document.value, name: "Hidden edit" }; await nextTick();
    expect(views.previewRefresh.value).toBe(first); expect(views.visibleFetcher.value).toBe(activeFetcher);
    document.value = { ...document.value, id: "replacement" }; await nextTick();
    expect(views.previewRefresh.value).toEqual({ retainPrevious: true, key: "replacement" });
    expect(views.previewRefresh.value).not.toBe(first); expect(views.previewVisited.value).toBe(false);
    mode.value = "preview"; await nextTick();
    expect(views.visibleFetcher.value).toBe(fetcher.value);
  } finally { scope.stop(); }
});
