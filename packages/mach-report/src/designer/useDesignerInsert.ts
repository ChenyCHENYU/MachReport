import { computed, ref, shallowRef, watch } from "vue";
import type {
  DatasetContract,
  DatasetRows,
  ReportTemplateDocument,
  TemplateComponent,
} from "@agile-team/mach-report";
import { insertionChart, insertionColumn } from "./insertion-binding";
import { inspectTemplateFieldUsage } from "../source/template-outline";
import {
  canvasComponentFitsPage,
  canvasComponentPlacement,
} from "./canvas-placement";
import {
  createCanvasComponent,
  appendCanvasColumn,
  removeCanvasColumn,
  type CanvasInsertKind,
} from "./canvas-commands";
import type { useTemplateWorkspace } from "./useTemplateWorkspace";
import type { useTemplateEditor } from "./useTemplateEditor";
import type { useTemplateInspector } from "./useTemplateInspector";
import {
  DESIGNER_INSERT_MESSAGES,
  type DesignerInsertMessages,
} from "./insertion-messages";

function labelCopies(
  document: ReportTemplateDocument,
  datasets: DatasetRows | undefined,
): number | undefined {
  const repeat = document.template.repeat;
  const rows = repeat && datasets?.[repeat.dataset];
  if (!repeat || !rows) return;
  const copies = repeat.copies ?? 1;
  if (typeof copies === "number")
    return Number.isSafeInteger(copies) && copies > 0 && copies <= 1000
      ? rows.length * copies
      : undefined;
  let total = 0;
  for (const row of rows) {
    const value = Object.getOwnPropertyDescriptor(row, copies.field)?.value;
    if (!Number.isSafeInteger(value) || value < 1 || value > 1000) return;
    total += value;
  }
  return total;
}

/** 追加入口按当前表格或逐记录模板绑定字段，宿主无需拼组件或维护列结构。 */
export function useDesignerInsert(
  editor: ReturnType<typeof useTemplateEditor>,
  workspace: ReturnType<typeof useTemplateWorkspace>,
  inspector: ReturnType<typeof useTemplateInspector>,
  schemas: () => Record<string, DatasetContract> | undefined,
  datasets: () => DatasetRows | undefined,
  messages: () => Partial<DesignerInsertMessages> | undefined,
) {
  const m = computed(() => ({ ...DESIGNER_INSERT_MESSAGES, ...messages() }));
  const notice = ref("");
  const pendingInsertion = shallowRef<{
    component: TemplateComponent;
    widthMm: number;
    heightMm: number;
    pageCount: number;
    copies?: number;
    repeat: boolean;
  }>();
  const confirmation = computed(() => {
    const pending = pendingInsertion.value;
    if (!pending) return;
    const pageImpact = pending.repeat
      ? m.value.labelPageImpact
      : m.value.reportPageImpact;
    const impacts = [pageImpact
      .replace("{before}", String(pending.pageCount))
      .replace("{after}", String(pending.pageCount + 1))];
    if (pending.copies !== undefined) {
      impacts.push(m.value.labelCountImpact
        .replace("{before}", String(pending.copies * pending.pageCount))
        .replace("{after}", String(pending.copies * (pending.pageCount + 1))));
    }
    return {
      title: m.value.newPageTitle,
      description: m.value.newPageDescription
        .replace("{width}", String(pending.widthMm))
        .replace("{height}", String(pending.heightMm)),
      impacts,
      confirm: m.value.newPageConfirm,
      cancel: m.value.newPageCancel,
    };
  });
  watch(
    [editor.draft, workspace.canvasPage, datasets, schemas],
    () => { pendingInsertion.value = undefined; },
    { flush: "sync" },
  );
  function commitInsertion(component: TemplateComponent): void {
    if (!workspace.canvas.insertPlaced(component)) return;
    notice.value = workspace.canvas.insertedOnNewPage.value ? m.value.newPage : "";
    workspace.setMode("design");
    inspector.section.value = "component";
  }
  function requestInsertion(component: TemplateComponent): void {
    const document = editor.draft.value;
    const page = document.template.pages[workspace.canvasPage.value]!;
    if (!canvasComponentFitsPage(page, component)) {
      notice.value = m.value.contentTooLarge;
      return;
    }
    if (canvasComponentPlacement(page, component).newPage) {
      notice.value = "";
      pendingInsertion.value = {
        component,
        widthMm: page.widthMm,
        heightMm: page.heightMm,
        pageCount: document.template.pages.length,
        copies: labelCopies(document, datasets()),
        repeat: !!document.template.repeat,
      };
      return;
    }
    commitInsertion(component);
  }
  function cancelInsertion(): void { pendingInsertion.value = undefined; }
  function confirmInsertion(): void {
    const pending = pendingInsertion.value;
    if (!pending || workspace.editDisabled.value) return;
    pendingInsertion.value = undefined;
    commitInsertion(pending.component);
  }
  const dataset = computed(
    () =>
      editor.draft.value.template.repeat?.dataset ??
      editor.activeList.value?.dataset ??
      Object.keys(schemas() ?? {})[0] ??
      Object.keys(datasets() ?? {})[0] ??
      "detail",
  );
  const schema = computed<DatasetContract>(() => {
    const declared = schemas()?.[dataset.value];
    if (declared) return declared;
    const list = editor.activeList.value;
    if (list?.dataset === dataset.value)
      return {
        fields: list.columns.map((column) => ({
          field: column.field,
          label: column.header,
          type: column.valueType === "number" ? "number" : "text",
          semanticRole: column.semanticRole,
        })),
      };
    return {
      fields: Object.keys(datasets()?.[dataset.value]?.[0] ?? {}).map(
        (field) => ({ field, type: "text" as const }),
      ),
    };
  });
  const fields = computed(() =>
    schema.value.fields.filter((field) => field.field !== schema.value.rowKey),
  );
  function insert(kind: CanvasInsertKind): void {
    if (workspace.editDisabled.value || pendingInsertion.value) return;
    const component = createCanvasComponent(kind, dataset.value);
    if (component.kind === "chart") {
      const binding = insertionChart(schema.value, dataset.value, m.value.recordCount);
      if (!binding) { notice.value = m.value.fieldsUnavailable; return; }
      component.chartBinding = binding;
    }
    if (component.kind === "list" && !fields.value.length) {
      notice.value = m.value.fieldsUnavailable;
      return;
    }
    if (component.kind === "text" && editor.draft.value.template.repeat) {
      const page =
        editor.draft.value.template.pages[workspace.canvasPage.value]!;
      component.widthMm = Math.min(60, page.widthMm / 2);
      component.heightMm = 6;
    }
    if (component.kind === "list" && fields.value.length)
      component.columns = fields.value
        .slice(0, 4)
        .map((field) => insertionColumn(field, 22.5));
    if (component.kind === "list")
      component.widthMm = component.columns.reduce(
        (sum, column) => sum + column.widthMm,
        0,
      );
    const identity =
      schema.value.fields.find(
        (field) =>
          field.semanticRole === "identifier" &&
          field.field !== schema.value.rowKey,
      )?.field ?? schema.value.rowKey;
    if (
      editor.draft.value.template.repeat &&
      identity &&
      (component.kind === "qrcode" || component.kind === "barcode")
    )
      component.binding = { field: identity };
    requestInsertion(component);
  }
  function addField(name: string): void {
    if (workspace.editDisabled.value || pendingInsertion.value) return;
    const field = fields.value.find((item) => item.field === name);
    if (!field) return;
    if (editor.draft.value.template.repeat) {
      const component = createCanvasComponent("text");
      if (component.kind === "list") return;
      component.widthMm = 42;
      component.heightMm = 5;
      component.text = "";
      component.style = { fontSize: 8, lineHeight: 1.1, verticalAlign: "middle" };
      component.binding = {
        field: name,
        prefix: `${field.label || name}  `,
        ...(field.format ? { format: field.format } : {}),
      };
      requestInsertion(component);
      return;
    }
    const location = editor.lists.value[editor.selected.value];
    if (
      !location ||
      editor.activeList.value?.columns.some((column) => column.field === name)
    )
      return;
    if (
      editor.transaction((document) => {
        const page = document.template.pages[location.pageIndex]!,
          list = page.components[location.componentIndex];
        if (list?.kind !== "list" || page.flow) return;
        appendCanvasColumn(
          list,
          insertionColumn(field, 28),
          page.layout === "wide",
        );
        if (page.layout === "wide")
          page.widthMm = Math.max(
            page.widthMm,
            list.leftMm + list.widthMm + (page.marginRightMm ?? 0),
          );
      })
    ) {
      inspector.section.value = "fields";
      inspector.activate(editor.activeList.value!.columns.length - 1);
    }
  }
  function removeColumn(): void {
    if (workspace.editDisabled.value) return;
    const location = editor.lists.value[editor.selected.value],
      list = editor.activeList.value;
    const index = inspector.activeIndex.value,
      column = list?.columns[index];
    if (!location || !list || !column || list.columns.length < 2) {
      notice.value = m.value.removeLast;
      return;
    }
    const path = `$.template.pages[${location.pageIndex}].components[${location.componentIndex}]`;
    const references = inspectTemplateFieldUsage(
      editor.draft.value.template,
      list.dataset,
      column.field,
    ).filter(
      (item) =>
        item.path.startsWith(path) &&
        item.path !== `${path}.columns[${index}].field`,
    );
    if (references.length) {
      notice.value = m.value.dependentColumn;
      return;
    }
    if (
      editor.transaction((document) => {
        const page = document.template.pages[location.pageIndex]!,
          target = page.components[location.componentIndex];
        if (target?.kind === "list" && !page.flow)
          removeCanvasColumn(target, index, page.layout === "wide");
      })
    ) {
      notice.value = "";
      inspector.activate(
        Math.min(index, editor.activeList.value!.columns.length - 1),
      );
    }
  }
  return {
    fields,
    schema,
    insert,
    addField,
    removeColumn,
    notice,
    confirmation,
    confirmInsertion,
    cancelInsertion,
    messages: m,
  };
}
