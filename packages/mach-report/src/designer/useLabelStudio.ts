import { computed, ref, shallowRef, watch, onMounted, onScopeDispose } from "vue";
import { createReportSource, defineLabelReport, imposeLabelSheets, inspectReportTemplateCompatibility, parseReportTemplate, serializeReportTemplate, type DatasetContract, type LabelReportRows, type ReportTemplate, type ReportTemplateDocument } from "@agile-team/mach-report";
import { createLazyLabelCodeAssets } from "./label-studio-assets";
import { labelStudioSheetLayout } from "./label-studio-sheets";
import { isCustomLabelStudioLayout, patchLabelStudioContent, rebuildLabelStudioDocument } from "./label-studio-content";
import { provideMachReportConfig, useMachReport } from "@agile-team/mach-report/vue";
import type { TemplateEditorController, TemplateEditorOptions } from "./useTemplateEditor";
import { useTemplateDiscard, type TemplateEditorBeforeDiscardContext } from "./useTemplateDiscard";
import { createLabelStudioDocument } from "./label-studio-template";
import { LABEL_STUDIO_PRESETS, labelDisplayFields, labelIdentityField, type LabelStudioLayout, type LabelStudioPreset, type LabelStudioBrand } from "./label-studio-presets";
import { LABEL_STUDIO_MESSAGES, type LabelStudioMessages } from "./label-studio-messages";

export interface LabelStudioOptions extends LabelStudioLayout {
  /** A host-owned completion action may replace the inner draft-save button. */
  showSave?: boolean;
  rows: LabelReportRows;
  schema: DatasetContract;
  title?: string;
  identityField?: string;
  /** Optional business provenance retained by generated label templates for safe reuse. */
  dataContract?: ReportTemplate["dataContract"];
  modelValue?: ReportTemplateDocument;
  preview?: TemplateEditorOptions["preview"];
  save?: TemplateEditorOptions["save"];
  beforeDiscard?: TemplateEditorOptions["beforeDiscard"];
  messages?: Partial<LabelStudioMessages>;
}
export interface LabelStudioController {
  readonly busy?: boolean;
  readonly pendingLocalChanges?: boolean;
  readonly mode: "preview" | "design";
  readonly canPrint: boolean;
  preview(): Promise<boolean>;
  print(): Promise<void>;
  guardChanges(): Promise<boolean>;
  prepare(): Promise<ReportTemplateDocument | undefined>;
}

function storedLayout(document: ReportTemplateDocument): LabelStudioLayout | undefined {
  const value = document.template.pages[0]?.meta?.labelStudio;
  if (!value || typeof value !== "object") return;
  const candidate = value as Record<string, unknown>;
  const preset = LABEL_STUDIO_PRESETS.find(preset => preset.id === candidate.preset);
  if (!preset) return;
  const fields = Array.isArray(candidate.fields) ? candidate.fields.filter((field): field is string => typeof field === "string") : undefined;
  if (fields && fields.length > 5) return;
  const source = candidate.brand && typeof candidate.brand === "object" ? candidate.brand as Record<string, unknown> : {};
  const brand: LabelStudioBrand = {};
  for (const key of ["name", "tagline", "logoData"] as const)
    if (typeof source[key] === "string") brand[key] = source[key];
  return { preset: preset.id, fields, brand };
}

function availableSelection(schema: DatasetContract, identity: string | undefined, selected?: readonly string[]): string[] {
  const available = new Set(schema.fields.filter(field => field.field !== identity && field.field !== schema.rowKey).map(field => field.field));
  const known = selected?.filter(field => available.has(field));
  return labelDisplayFields(schema, identity, known).map(field => field.field);
}

/** One persistent editor owns history; full record output and bounded design samples stay separate. */
export function useLabelStudio(props: LabelStudioOptions, emit: (document: ReportTemplateDocument) => void) {
  const preview = useMachReport();
  const m = computed(() => ({ ...LABEL_STUDIO_MESSAGES, ...props.messages }));
  const title = computed(() => props.title ?? m.value.title);
  const initialLayout = { preset: props.preset, brand: props.brand, fields: props.fields };
  const document = shallowRef(props.modelValue ? parseReportTemplate(props.modelValue) : createLabelStudioDocument(props.schema, title.value, props.identityField, initialLayout, props.dataContract));
  const savedDocument = shallowRef(parseReportTemplate(document.value));
  const editorVisited = ref(false), editorInitialDocument = shallowRef<ReportTemplateDocument>();
  let beforeEditorChange: ReportTemplateDocument | undefined;
  let saveController: AbortController | undefined;
  onMounted(() => { if (!props.modelValue) emit(parseReportTemplate(document.value)); });
  const mode = ref<"preview" | "design">("preview"), record = ref("all"), recordIndex = ref(1), sheet = ref(false), operating = ref(false);
  const editor = ref<TemplateEditorController>();
  const discard = useTemplateDiscard(() => props.beforeDiscard);
  const busy = computed(() => operating.value || discard.pending.value || editorVisited.value && !editor.value || editor.value?.saving === true || editor.value?.blocked === true || preview.state.printing || preview.state.exporting !== null);
  const notice = ref("");
  const identity = computed(() => labelIdentityField(props.schema, props.identityField));
  const preset = ref<LabelStudioPreset | undefined>(storedLayout(document.value)?.preset ?? (props.modelValue ? undefined : props.preset ?? "paired"));
  const brandName = ref(storedLayout(document.value)?.brand?.name ?? props.brand?.name ?? "");
  const brandTagline = ref(storedLayout(document.value)?.brand?.tagline ?? props.brand?.tagline ?? "");
  const fields = ref<string[]>(availableSelection(props.schema, identity.value, storedLayout(document.value)?.fields ?? props.fields));
  const fieldQuery = ref("");
  const candidates = computed(() => props.schema.fields.filter(field => field.field !== identity.value && field.field !== props.schema.rowKey));
  const selectedFields = computed(() => fields.value.map(field => ({ field, label: props.schema.fields.find(candidate => candidate.field === field)?.label ?? field })));
  const availableFields = computed(() => {
    const query = fieldQuery.value.trim().toLocaleLowerCase();
    return candidates.value.filter(field => `${field.label ?? ""} ${field.field}`.toLocaleLowerCase().includes(query)).slice(0, 30);
  });
  const brandLogo = computed(() => {
    const component = document.value.template.pages[0]?.components.find(component => component.kind === "image" && component.meta?.labelBrandLogo);
    return component?.kind === "image" ? component.imageData : props.brand?.logoData;
  });
  const configuration = computed<LabelStudioLayout>(() => ({
    preset: preset.value,
    fields: fields.value,
    brand: { ...props.brand, ...(brandLogo.value ? { logoData: brandLogo.value } : {}), name: brandName.value, tagline: brandTagline.value },
  }));
  let metadata = JSON.stringify(storedLayout(document.value));
  const custom = computed(() => {
    const layout = storedLayout(document.value);
    if (!layout) return true;
    try {
      const canonical = createLabelStudioDocument(props.schema, title.value, props.identityField, { ...layout, brand: { ...layout.brand, ...(brandLogo.value ? { logoData: brandLogo.value } : {}) } });
      return isCustomLabelStudioLayout(document.value, canonical);
    } catch { return true; }
  });
  const rebuilding = ref(false);
  const layoutChanged = computed(() => preset.value !== storedLayout(document.value)?.preset);
  const formSnapshot = () => JSON.stringify({ preset: preset.value, fields: fields.value, name: brandName.value, tagline: brandTagline.value });
  const configurationBaseline = ref(formSnapshot());
  const configurationDirty = computed(() => formSnapshot() !== configurationBaseline.value);
  const documentJson = computed(() => serializeReportTemplate(document.value));
  const savedJson = computed(() => serializeReportTemplate(savedDocument.value));
  const documentDirty = computed(() => documentJson.value !== savedJson.value);
  const pendingLocalChanges = computed(() => configurationDirty.value || documentDirty.value || editor.value?.pendingLocalChanges === true);
  function restoreConfiguration(): void {
    rebuilding.value = false;
    const layout = storedLayout(document.value);
    preset.value = layout?.preset;
    fields.value = availableSelection(props.schema, identity.value, layout?.fields ?? props.fields);
    brandName.value = layout?.brand?.name ?? props.brand?.name ?? "";
    brandTagline.value = layout?.brand?.tagline ?? props.brand?.tagline ?? "";
    metadata = JSON.stringify(layout);
    configurationBaseline.value = formSnapshot();
  }
  function syncConfiguration(value: ReportTemplateDocument): void {
    const layout = storedLayout(value);
    const next = JSON.stringify(layout);
    if (next === metadata) return;
    metadata = next;
    restoreConfiguration();
  }
  let disposed = false;
  onScopeDispose(() => { disposed = true; saveController?.abort(); });
  const assets = createLazyLabelCodeAssets();
  provideMachReportConfig({ get defaults() { return { ...props.preview, assets: { ...assets, ...props.preview?.assets, assetRenderers: { ...assets.assetRenderers, ...props.preview?.assets?.assetRenderers } } }; } });
  watch(editor, control => {
    const initial = editorInitialDocument.value;
    if (!control || !initial) return;
    const current = document.value;
    if (serializeReportTemplate(initial) !== documentJson.value) control.applyTemplate?.(current.template);
    editorInitialDocument.value = undefined;
    beforeEditorChange = undefined;
  }, { flush: "post" });
  watch([preset, fields, brandName, brandTagline], () => { rebuilding.value = false; });
  watch(() => props.modelValue, value => {
    if (value && serializeReportTemplate(value) !== documentJson.value) {
      document.value = parseReportTemplate(value);
      savedDocument.value = parseReportTemplate(value);
      beforeEditorChange = undefined;
      syncConfiguration(value);
    }
  });
  watch(() => props.rows, () => { record.value = "all"; recordIndex.value = 1; });
  function update(value: ReportTemplateDocument): void {
    notice.value = "";
    document.value = value;
    syncConfiguration(value);
    emit(value);
  }
  function toggleField(field: string, selected: boolean): void {
    if (selected && fields.value.length < 5 && !fields.value.includes(field)) fields.value = [...fields.value, field];
    else if (!selected) fields.value = fields.value.filter(value => value !== field);
  }
  function applyConfiguration(rebuild = false): boolean {
    if (busy.value || disposed) return false;
    if (!preset.value) { notice.value = m.value.choosePreset; return false; }
    if (editor.value?.canApply === false) { notice.value = editor.value.saveReason || m.value.applyFirst; return false; }
    if (layoutChanged.value && !rebuild) { rebuilding.value = true; return false; }
    try {
      const previous = storedLayout(document.value);
      let next: ReportTemplateDocument | undefined;
      if (rebuild) {
        next = rebuildLabelStudioDocument(document.value, props.schema, title.value, props.identityField, configuration.value);
      } else if (previous) {
        next = patchLabelStudioContent(document.value, props.schema, title.value, props.identityField, previous, configuration.value);
      }
      if (!next) { notice.value = m.value.contentNeedsDesign; return false; }
      if (editor.value?.applyTemplate) {
        if (!editor.value.applyTemplate(next.template)) { notice.value = m.value.saveFailed; return false; }
      } else {
        beforeEditorChange = parseReportTemplate(document.value);
        update(next);
      }
      rebuilding.value = false;
      configurationBaseline.value = formSnapshot();
      return true;
    } catch (cause) {
      notice.value = cause instanceof Error ? cause.message : m.value.saveFailed;
      return false;
    }
  }
  const rows = computed(() => record.value === "all" ? props.rows : Number.isSafeInteger(recordIndex.value) && props.rows[recordIndex.value - 1] ? [props.rows[recordIndex.value - 1]!] : []);
  const dataset = computed(() => document.value.template.repeat?.dataset ?? "records");
  const datasets = computed(() => ({ [dataset.value]: rows.value as Record<string, unknown>[] }));
  const designDatasets = computed(() => ({ [dataset.value]: rows.value.slice(0, 3) as Record<string, unknown>[] }));
  const schemas = computed(() => ({ [dataset.value]: props.schema }));
  const bindings = computed(() => [{ id: dataset.value, label: title.value, rowKey: props.schema.rowKey, fields: props.schema.fields }]);
  const paper = computed(() => document.value.template.pages[0]);
  const pageCount = computed(() => document.value.template.pages.length);
  const copiesNumber = computed(() => {
    const copies = document.value.template.repeat?.copies ?? 1;
    return typeof copies === "number" ? copies : undefined;
  });
  const copiesField = computed(() => {
    const copies = document.value.template.repeat?.copies;
    return typeof copies === "object" ? copies.field : undefined;
  });
  const dynamicCopies = computed(() => {
    const field = copiesField.value;
    if (!field) return undefined;
    let total = 0;
    for (const row of rows.value) {
      const value = Object.getOwnPropertyDescriptor(row, field)?.value;
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 1000) return undefined;
      total += value;
    }
    return total;
  });
  const labelCount = computed(() => {
    const copies = copiesNumber.value;
    if (copies !== undefined)
      return Number.isSafeInteger(copies) && copies >= 1 && copies <= 1000 ? rows.value.length * copies * pageCount.value : undefined;
    return dynamicCopies.value === undefined ? undefined : dynamicCopies.value * pageCount.value;
  });
  const sheetLayout = computed(() => labelStudioSheetLayout(document.value.template));
  const sheetHint = computed(() => {
    const value = sheetLayout.value;
    return value ? m.value.sheetHint.replace("{columns}", String(value.columns)).replace("{rows}", String(value.rows)).replace("{capacity}", String(value.capacity)) : m.value.sheetUnavailable;
  });
  watch(sheetLayout, value => { if (!value) sheet.value = false; });
  const fetcher = computed(() => {
    const source = createReportSource({ labels: defineLabelReport({ template: document.value.template, rows: rows.value, dataSchema: props.schema }) });
    const imposed = sheet.value ? sheetLayout.value : undefined;
    const compatibility = props.dataContract ? inspectReportTemplateCompatibility(document.value.template, props.dataContract) : undefined;
    return async (input: Parameters<typeof source>[0]) => {
      if (compatibility && !compatibility.ok) throw new Error(compatibility.issues.map(issue => issue.message).join("；"));
      const plan = await source(input);
      return imposed ? imposeLabelSheets(plan, { ...imposed, signal: input.signal }) : plan;
    };
  });
  const save: NonNullable<TemplateEditorOptions["save"]> = async (draft, context) => {
    if (disposed || context.signal.aborted) throw new DOMException("标签模板保存已取消", "AbortError");
    const snapshot = parseReportTemplate(draft);
    const saved = parseReportTemplate(props.save ? await props.save(snapshot, context) : snapshot);
    if (saved.id !== draft.id) throw new Error(m.value.invalidSavedTemplate);
    if (disposed || context.signal.aborted) throw new DOMException("标签模板保存已取消", "AbortError");
    savedDocument.value = parseReportTemplate(saved); update(saved); return saved;
  };
  async function prepare(): Promise<ReportTemplateDocument | undefined> {
    if (busy.value || disposed) return;
    if (configurationDirty.value && layoutChanged.value) { notice.value = m.value.applyLayoutFirst; return; }
    if (configurationDirty.value && !applyConfiguration()) return;
    operating.value = true;
    try {
      if (editor.value) {
        if (editor.value.canApply === false) { notice.value = editor.value.saveReason || m.value.applyFirst; return; }
        if (editor.value.pendingLocalChanges) await editor.value.save();
        if (editor.value.pendingLocalChanges) { notice.value = m.value.saveFailed; return; }
      } else if (documentDirty.value) {
        saveController = new AbortController();
        await save(document.value, { expectedRevision: document.value.revision, signal: saveController.signal });
        beforeEditorChange = undefined;
      }
      if (!disposed) { notice.value = ""; return parseReportTemplate(document.value); }
    } catch (cause) {
      if (!disposed) notice.value = cause instanceof Error ? cause.message : m.value.saveFailed;
    } finally { operating.value = false; saveController = undefined; }
  }
  async function navigate(next: "preview" | "design"): Promise<void> {
    if (busy.value || next === mode.value) return;
    if (next === "design" && !editorVisited.value) {
      if (configurationDirty.value && layoutChanged.value) { notice.value = m.value.applyLayoutFirst; return; }
      if (configurationDirty.value && !applyConfiguration()) return;
      editorInitialDocument.value = beforeEditorChange;
      editorVisited.value = true;
      mode.value = next;
    } else if (await prepare()) mode.value = next;
  }
  function failDesignLoad(cause: unknown): void {
    editorVisited.value = false; mode.value = "preview";
    notice.value = `${m.value.designLoadFailed} ${cause instanceof Error ? cause.message : String(cause)}`;
  }
  let approvedReset = false;
  const beforeDiscard = (context: TemplateEditorBeforeDiscardContext) => approvedReset || discard.request(context);
  async function guardChanges(): Promise<boolean> {
    if (busy.value) return false;
    const pending = editor.value?.pendingLocalChanges === true;
    if (!pending && !documentDirty.value && !configurationDirty.value) return true;
    const allowed = pending && editor.value
      ? await editor.value.guardChanges()
      : await discard.request({ reason: "replace", document: parseReportTemplate(document.value), pendingLocalChanges: true });
    if (!allowed || disposed) return false;
    if (pending && editor.value) {
      approvedReset = true;
      try { await editor.value.reset(); } finally { approvedReset = false; }
    }
    update(parseReportTemplate(savedDocument.value));
    beforeEditorChange = undefined;
    restoreConfiguration();
    return true;
  }
  const canPrint = computed(() => mode.value === "preview" && !busy.value && preview.state.canPrint);
  async function showPreview(): Promise<boolean> {
    await navigate("preview");
    return !disposed && mode.value === "preview";
  }
  async function print(): Promise<void> {
    if (canPrint.value) await preview.print();
  }
  return { m, notice, title, document, mode, preview, showPreview, print, canPrint, editorVisited, editorInitialDocument, failDesignLoad, sheetLayout, sheetHint, rebuilding, layoutChanged, record, recordIndex, sheet, busy, editor, rows, datasets, designDatasets, schemas, bindings, paper, labelCount, fetcher, update, save, navigate, prepare, guardChanges, preset, presets: LABEL_STUDIO_PRESETS, brandName, brandTagline, fields, fieldQuery, selectedFields, availableFields, fieldCount: computed(() => candidates.value.length), configurationDirty, pendingLocalChanges, custom, toggleField, applyConfiguration, requestRebuild: () => { rebuilding.value = true; }, cancelRebuild: () => { rebuilding.value = false; }, restoreConfiguration, beforeDiscard, confirmation: discard.confirmation, decideDiscard: discard.decide };
}
