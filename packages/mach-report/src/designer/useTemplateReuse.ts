import { computed, ref, watch } from "vue";
import type {
  ComponentStyle,
  ReportTemplateDocument,
} from "@agile-team/mach-report";
import {
  applyReportDocumentStyle,
  captureTemplateFragment,
  insertTemplateFragment,
  inspectTemplateFragmentBindings,
  type ReportDocumentStyle,
  type ReportTemplateFragment,
  type TemplateFragmentBindings,
} from "../source/template-fragments";
import type { CanvasSelection } from "./canvas-commands";
import {
  TEMPLATE_PRODUCT_MESSAGES,
  type TemplateProductMessages,
} from "./product-messages";
export interface TemplateReuseOptions {
  document: ReportTemplateDocument;
  pageIndex: number;
  selection?: CanvasSelection;
  fragments?: readonly ReportTemplateFragment[];
  styles?: readonly ReportDocumentStyle[];
  disabled?: boolean;
  messages?: Partial<TemplateProductMessages>;
  accept: (change: (document: ReportTemplateDocument) => void) => boolean;
}
export function useTemplateReuse(
  props: TemplateReuseOptions,
  select: (location: CanvasSelection) => void,
) {
  const m = computed(() => ({
    ...TEMPLATE_PRODUCT_MESSAGES,
    ...props.messages,
  }));
  const local = ref<ReportTemplateFragment[]>([]),
    fragmentId = ref(""),
    styleId = ref("body"),
    name = ref(""),
    error = ref("");
  const clipboard = ref<ComponentStyle>(),
    bindings = ref<TemplateFragmentBindings>({});
  const fragments = computed(() => [
    ...(props.fragments ?? []),
    ...local.value,
  ]);
  watch(
    fragments,
    (items) => {
      if (!items.some((item) => item.id === fragmentId.value))
        fragmentId.value = items[0]?.id ?? "";
    },
    { immediate: true },
  );
  const fragment = computed(
    () =>
      fragments.value.find((item) => item.id === fragmentId.value) ??
      fragments.value[0],
  );
  const required = computed(() => {
    try {
      return fragment.value
        ? inspectTemplateFragmentBindings(fragment.value)
        : [];
    } catch (cause) {
      return [{ dataset: "", fields: [], error: String(cause) }];
    }
  });
  watch(
    fragment,
    () => {
      bindings.value = {
        datasets: Object.fromEntries(
          required.value.map((item) => [
            item.dataset,
            props.document.template.repeat?.dataset ?? item.dataset,
          ]),
        ),
        fields: Object.fromEntries(
          required.value.map((item) => [
            item.dataset,
            Object.fromEntries(item.fields.map((field) => [field, field])),
          ]),
        ),
      };
    },
    { immediate: true },
  );
  const active = computed(() =>
    props.selection?.pageIndex === props.pageIndex
      ? props.document.template.pages[props.pageIndex]?.components[
          props.selection.componentIndex
        ]
      : undefined,
  );
  const instance = computed(
    () =>
      active.value?.meta?.fragment as
        | { id: string; revision: string; instance: string }
        | undefined,
  );
  const canUpdate = computed(
    () =>
      instance.value &&
      fragment.value?.id === instance.value.id &&
      fragment.value.revision !== instance.value.revision,
  );
  const styles = computed<readonly ReportDocumentStyle[]>(() =>
    props.styles?.length
      ? props.styles
      : [
          {
            id: "title",
            name: m.value.styleText,
            style: { fontSize: 18, bold: true, color: "#183b65" },
          },
          {
            id: "heading",
            name: m.value.styleHeading,
            target: "header",
            style: {
              fontSize: 10,
              bold: true,
              color: "#21466e",
              backgroundColor: "#eaf2fb",
              align: "center",
              verticalAlign: "middle",
            },
          },
          {
            id: "body",
            name: m.value.styleBody,
            style: { fontSize: 10, color: "#334155", bold: false },
          },
          {
            id: "number",
            name: m.value.styleNumber,
            style: { fontSize: 10, align: "right", color: "#334155" },
          },
          {
            id: "note",
            name: m.value.styleNote,
            style: { fontSize: 8, color: "#64748b", bold: false },
          },
        ],
  );
  const style = computed(
    () =>
      styles.value.find((item) => item.id === styleId.value) ??
      styles.value[0]!,
  );
  watch(
    styles,
    (items) => {
      if (!items.some((item) => item.id === styleId.value))
        styleId.value = items[0]?.id ?? "";
    },
    { immediate: true },
  );
  function perform(action: () => void): void {
    if (props.disabled) return;
    error.value = "";
    try {
      action();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  function capture(): void {
    perform(() => {
      if (!props.selection || !active.value) throw new Error(m.value.select);
      if (!name.value.trim()) throw new Error(m.value.nameRequired);
      let sequence = local.value.length + 1;
      const used = new Set(fragments.value.map((item) => item.id));
      while (used.has(`session-fragment-${sequence}`)) sequence++;
      const id = `session-fragment-${sequence}`;
      local.value.push(
        captureTemplateFragment(
          props.document,
          props.pageIndex,
          [props.selection.componentIndex],
          { id, name: name.value.trim(), revision: "1" },
        ),
      );
      fragmentId.value = id;
      name.value = "";
    });
  }
  function insert(update = false): void {
    perform(() => {
      if (!fragment.value) return;
      const result = insertTemplateFragment(props.document, fragment.value, {
        pageIndex: props.pageIndex,
        bindings: bindings.value,
        ...(update ? { replaceInstance: instance.value?.instance } : {}),
      });
      if (
        props.accept((document) => {
          document.template = result.document.template;
        })
      )
        select({
          pageIndex: props.pageIndex,
          componentIndex: result.componentIndices[0]!,
        });
    });
  }
  function apply(role = style.value): void {
    perform(() => {
      if (!props.selection || !active.value) return;
      const result = applyReportDocumentStyle(
        props.document,
        props.pageIndex,
        [props.selection.componentIndex],
        role,
      );
      props.accept((document) => {
        document.template = result.template;
      });
    });
  }
  function copyStyle(): void {
    if (active.value)
      clipboard.value = JSON.parse(
        JSON.stringify(
          active.value.kind === "list"
            ? (active.value.columns[0]?.style ?? {})
            : (active.value.style ?? {}),
        ),
      ) as ComponentStyle;
  }
  return {
    m,
    local,
    name,
    fragmentId,
    fragments,
    fragment,
    bindings,
    required,
    active,
    instance,
    canUpdate,
    error,
    styles,
    styleId,
    style,
    clipboard,
    capture,
    insert,
    apply,
    copyStyle,
  };
}
