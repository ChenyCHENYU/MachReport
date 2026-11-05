import { computed, ref, shallowRef, watch, onMounted, onScopeDispose } from "vue";
import { createReportSource, defineLabelReport, imposeLabelSheets, parseReportTemplate, serializeReportTemplate, type DatasetContract, type LabelReportRows, type ReportTemplateDocument } from "@agile-team/mach-report";
import { createCodeAssetRenderers } from "@agile-team/mach-report/codes";
import { provideMachReportConfig } from "@agile-team/mach-report/vue";
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
  modelValue?: ReportTemplateDocument;
  preview?: TemplateEditorOptions["preview"];
  save?: TemplateEditorOptions["save"];
  beforeDiscard?: TemplateEditorOptions["beforeDiscard"];
  messages?: Partial<LabelStudioMessages>;
}
export interface LabelStudioController { readonly busy?: boolean; readonly pendingLocalChanges?: boolean; guardChanges(): Promise<boolean>; prepare(): Promise<ReportTemplateDocument | undefined> }

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
  const m = computed(() => ({ ...LABEL_STUDIO_MESSAGES, ...props.messages }));
  const title = computed(() => props.title ?? m.value.title);
  const initialLayout = { preset: props.preset, brand: props.brand, fields: props.fields };
  const document = shallowRef(props.modelValue ? parseReportTemplate(props.modelValue) : createLabelStudioDocument(props.schema, title.value, props.identityField, initialLayout));
  let savedDocument = parseReportTemplate(document.value);
  onMounted(() => { if (!props.modelValue) emit(parseReportTemplate(document.value)); });
  const mode = ref<"preview" | "design">("preview"), record = ref("all"), recordIndex = ref(1), sheet = ref(false), operating = ref(false);
  const editor = ref<TemplateEditorController>();
  const discard = useTemplateDiscard(() => props.beforeDiscard);
  const busy = computed(() => operating.value || discard.pending.value || editor.value?.saving === true || editor.value?.blocked === true);
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
  const custom = computed(() => !storedLayout(document.value));
  const formSnapshot = () => JSON.stringify({ preset: preset.value, fields: fields.value, name: brandName.value, tagline: brandTagline.value });
  const configurationBaseline = ref(formSnapshot());
  const configurationDirty = computed(() => formSnapshot() !== configurationBaseline.value);
  const pendingLocalChanges = computed(() => configurationDirty.value || editor.value?.pendingLocalChanges === true);
  function restoreConfiguration(): void {
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
  onScopeDispose(() => { disposed = true; });
  const assets = { assetRenderers: createCodeAssetRenderers() };
  provideMachReportConfig({ get defaults() { return { assets, ...props.preview }; } });
  watch(() => props.modelValue, value => {
    if (value && serializeReportTemplate(value) !== serializeReportTemplate(document.value)) {
      document.value = parseReportTemplate(value);
      savedDocument = parseReportTemplate(value);
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
  function applyConfiguration(): boolean {
    if (busy.value || disposed) return false;
    if (!preset.value) { notice.value = m.value.choosePreset; return false; }
    if (editor.value?.canApply === false) { notice.value = editor.value.saveReason || m.value.applyFirst; return false; }
    try {
      const next = createLabelStudioDocument(props.schema, title.value, props.identityField, configuration.value);
      const repeat = document.value.template.repeat;
      if (repeat?.copies !== undefined && next.template.repeat) next.template.repeat.copies = repeat.copies;
      if (editor.value?.applyTemplate) {
        if (!editor.value.applyTemplate(next.template)) { notice.value = m.value.saveFailed; return false; }
      } else {
        update({ ...document.value, template: next.template });
      }
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
  const fetcher = computed(() => {
    const source = createReportSource({ labels: defineLabelReport({ template: document.value.template, rows: rows.value, dataSchema: props.schema }) });
    const imposed = sheet.value;
    return async (input: Parameters<typeof source>[0]) => {
      const plan = await source(input);
      return imposed ? imposeLabelSheets(plan, { paper: "a4", columns: 2, rows: 4, marginMm: 12, gapMm: 4, signal: input.signal }) : plan;
    };
  });
  const save: NonNullable<TemplateEditorOptions["save"]> = async (draft, context) => {
    const saved = props.save ? await props.save(draft, context) : parseReportTemplate(draft);
    if (disposed || context.signal.aborted) throw new DOMException("标签模板保存已取消", "AbortError");
    savedDocument = parseReportTemplate(saved); update(saved); return saved;
  };
  async function prepare(): Promise<ReportTemplateDocument | undefined> {
    if (busy.value || disposed) return;
    if (configurationDirty.value && !applyConfiguration()) return;
    operating.value = true;
    try {
      if (editor.value) {
        if (editor.value.canApply === false) { notice.value = editor.value.saveReason || m.value.applyFirst; return; }
        if (editor.value.pendingLocalChanges) await editor.value.save();
        if (editor.value.pendingLocalChanges) { notice.value = m.value.saveFailed; return; }
      }
      if (!disposed) { notice.value = ""; return parseReportTemplate(document.value); }
    } finally { operating.value = false; }
  }
  async function navigate(next: "preview" | "design"): Promise<void> {
    if (next !== mode.value && await prepare()) mode.value = next;
  }
  let approvedReset = false;
  const beforeDiscard = (context: TemplateEditorBeforeDiscardContext) => approvedReset || discard.request(context);
  async function guardChanges(): Promise<boolean> {
    if (busy.value) return false;
    const pending = editor.value?.pendingLocalChanges === true;
    if (!pending && !configurationDirty.value) return true;
    const allowed = pending && editor.value
      ? await editor.value.guardChanges()
      : await discard.request({ reason: "replace", document: parseReportTemplate(document.value), pendingLocalChanges: true });
    if (!allowed || disposed) return false;
    if (pending && editor.value) {
      approvedReset = true;
      try { await editor.value.reset(); } finally { approvedReset = false; }
      update(parseReportTemplate(savedDocument));
    }
    restoreConfiguration();
    return true;
  }
  return { m, notice, title, document, mode, record, recordIndex, sheet, busy, editor, rows, datasets, designDatasets, schemas, bindings, paper, labelCount, fetcher, update, save, navigate, prepare, guardChanges, preset, presets: LABEL_STUDIO_PRESETS, brandName, brandTagline, fields, fieldQuery, selectedFields, availableFields, fieldCount: computed(() => candidates.value.length), configurationDirty, pendingLocalChanges, custom, toggleField, applyConfiguration, restoreConfiguration, beforeDiscard, confirmation: discard.confirmation, decideDiscard: discard.decide };
}
