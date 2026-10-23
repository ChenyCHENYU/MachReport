import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useExcelRegionBindings } from "./useExcelRegionBindings";
import { createExcelRegionBindingDocument, createExcelRegionBindingSession, parseExcelRegionBindingSession, type AnyExcelBindingDocumentResult, type AnyExcelBindingSession } from "../xlsx/region-binding-workflow";
import { useTemplateToolDraft } from "./useTemplateToolDrafts";
import { useLocalDraft } from "./useLocalDraft";
import type { ExcelWorkbookSession } from "../xlsx/workbook-session";
import type { ExcelWorkbookSheet } from "../xlsx/import-template";
import type {
  ExcelImportOptions,
  ExcelImportResult,
} from "../xlsx/import-types";
import { getExcelSheetWindow } from "../xlsx/binding-preview";
import { columnName, parseImportRange } from "../xlsx/import-range";
import {
  createExcelBindingDocument,
  createExcelBindingSession,
  excelBindingRowRange,
  parseExcelBindingSession,
  validateExcelBindingFields,
  validateExcelBindingRegions,
  type ExcelBindingDataset,
  type ExcelBindingRecipe,
  type ExcelBindingRegion,
  type ExcelBindingIssue,
} from "../xlsx/binding-workflow";
import {
  EXCEL_BINDING_MESSAGES,
  type ExcelBindingMessages,
} from "./excel-binding-messages";
import { bindingTargetRange, excelTableIssueTarget, type ExcelBindingTarget } from "./excel-binding-guidance";

export type ExcelBindingWizardApply = AnyExcelBindingDocumentResult & { session: AnyExcelBindingSession };
export interface ExcelBindingWizardOptions {
  datasets: readonly ExcelBindingDataset[];
  /** An embedded editor can decline replacement; success is shown only after acceptance. */
  accept?: (result: ExcelBindingWizardApply) => boolean | Promise<boolean>;
  /** Source + exact coordinates + mappings. No File, functions, network credentials, or live result rows. */
  session?: AnyExcelBindingSession;
  identity?: { id: string; name: string };
  /** Editor replacement keeps the current persistent ID; standalone creation remains editable. */
  lockId?: boolean;
  readonly?: boolean;
  importOptions?: Pick<ExcelImportOptions, "layout" | "landscape" | "limits">;
  messages?: Partial<ExcelBindingMessages>;
}
function emptyRecipe(sheet = "", columns = 0): ExcelBindingRecipe {
  return {
    version: "1.0",
    sheet,
    dataset: "",
    regions: { header: "", detail: "" },
    fields: Array.from({ length: columns }, () => ""),
    rowKey: "",
  };
}
function text(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Controls interaction and cancellation only; binding and validation stay in framework-free /xlsx functions. */
export function useExcelBindingWizard(
  props: ExcelBindingWizardOptions,
  emit: (result: ExcelBindingWizardApply) => void,
) {
  const imported = shallowRef<ExcelImportResult>();
  const recipe = ref(emptyRecipe());
  const mode = ref<"table" | "regions">("table");
  const regionBindings = useExcelRegionBindings(imported, computed(() => recipe.value.sheet), computed(() => disabled.value), () => props.datasets);
  const sheetRecipes = new Map<string, ExcelBindingRecipe>();
  const regionSheetRecipes = new Map<string, typeof regionBindings.recipe.value>();
  const cachedDrafts = ref({ table: [] as ExcelBindingRecipe[], regions: [] as typeof regionBindings.recipe.value[] });
  function clearSheetDrafts(): void { sheetRecipes.clear(); regionSheetRecipes.clear(); cachedDrafts.value = { table: [], regions: [] }; }
  function cacheCurrentSheet(): void {
    if (!recipe.value.sheet) return;
    sheetRecipes.set(recipe.value.sheet, cloneRecipe(recipe.value));
    regionSheetRecipes.set(recipe.value.sheet, JSON.parse(JSON.stringify(regionBindings.recipe.value)) as typeof regionBindings.recipe.value);
    cachedDrafts.value = { table: [...sheetRecipes.values()], regions: [...regionSheetRecipes.values()] };
  }
  const cloneRecipe = (value: ExcelBindingRecipe) => JSON.parse(JSON.stringify(value)) as ExcelBindingRecipe;
  function sheetRecipe(name: string, columns: number): ExcelBindingRecipe { return cloneRecipe(sheetRecipes.get(name) ?? emptyRecipe(name, columns)); }
  const identity = ref({
    id: props.identity?.id ?? "excel-template",
    name: props.identity?.name ?? "Excel 业务模板",
  });
  const sourceName = ref("");
  const recoveredMapping = ref(false);
  const declaration = () => ({ recipe: recipe.value, regions: regionBindings.recipe.value, mode: mode.value, cached: cachedDrafts.value, identity: identity.value });
  type MappingDeclaration = ReturnType<typeof declaration>;
  let pendingMapping: MappingDeclaration | undefined;
  function applyRecoveredMapping(value: MappingDeclaration): void {
    recipe.value = cloneRecipe(value.recipe); regionBindings.reset(value.regions); mode.value = value.mode;
    identity.value = { ...value.identity, ...(props.lockId && props.identity ? { id: props.identity.id } : {}) };
    clearSheetDrafts();
    for (const item of value.cached.table) sheetRecipes.set(item.sheet, item);
    for (const item of value.cached.regions) regionSheetRecipes.set(item.sheet, item);
    cachedDrafts.value = value.cached;
  }
  const sourceRevision = ref(0);
  const localDraft = useLocalDraft(() => ({ source: sourceRevision.value, recipe: recipe.value, mode: mode.value, regions: regionBindings.recipe.value, cached: cachedDrafts.value, identity: identity.value }));
  const sheetChoices = ref<Pick<ExcelWorkbookSheet, "name" | "index">[]>([]);
  let workbook: ExcelWorkbookSession | undefined;
  function releaseWorkbook(): void { workbook?.dispose(); workbook = undefined; }
  const error = ref("");
  const loading = ref(false);
  const checked = ref(false);
  const applied = ref(false);
  const applying = ref(false);
  const row = ref(1),
    column = ref(1),
    anchor = ref<number>(),
    end = ref<number>();
  const mappingPage = ref(0);
  const m = computed(() => ({ ...EXCEL_BINDING_MESSAGES, ...props.messages }));
  const disabled = computed(() => !!props.readonly || loading.value || applying.value);
  const canCheck = computed(() => !loading.value && !applying.value);
  const sheet = computed(() =>
    imported.value?.sheets.find((item) => item.name === recipe.value.sheet),
  );
  const sourceRange = computed(() =>
    sheet.value ? parseImportRange(sheet.value.range) : undefined,
  );
  const dataset = computed(() =>
    props.datasets.find((item) => item.id === recipe.value.dataset),
  );
  const window = computed(() =>
    imported.value && sheet.value
      ? getExcelSheetWindow(imported.value, sheet.value.name, {
          row: row.value,
          column: column.value,
        })
      : undefined,
  );
  // The region computation tracks only sheet/regions; changing a field never rescans source grids.
  const regionIssues = computed(() =>
    imported.value
      ? validateExcelBindingRegions(imported.value, recipe.value)
      : [],
  );
  const tableValidation = computed(() => {
    if (!imported.value) return { ok: false, issues: [], mapped: 0, total: 0 };
    const result = validateExcelBindingFields(
      imported.value,
      recipe.value,
      props.datasets,
    );
    const issues = [...regionIssues.value, ...result.issues];
    return { ...result, ok: issues.length === 0, issues };
  });
  const validation = computed(() => mode.value === "regions" ? regionBindings.validation.value : tableValidation.value);
  const tableFocus = ref<{ target: ExcelBindingTarget; sequence: number }>();
  const focusTarget = computed(() => mode.value === "regions" ? regionBindings.focusTarget.value : tableFocus.value);
  function issueTarget(issue: ExcelBindingIssue): ExcelBindingTarget { return mode.value === "regions" ? regionBindings.target(issue) : excelTableIssueTarget(issue, recipe.value); }
  function targetLabel(target: ExcelBindingTarget): string {
    const labels: Record<string, string> = { dataset: m.value.dataset, contract: m.value.dataContract, rowKey: m.value.rowKey, range: m.value.regionCoordinates, field: m.value.mapping, fields: m.value.mapping, footer: m.value.flowFooter, header: m.value.headerRegion, detail: m.value.detailRegion, title: m.value.titleRegion, sheet: m.value.sheet, regions: mode.value === "regions" ? m.value.multiRegions : m.value.regionLegend, revisionField: m.value.revisionField, sourceTokenField: m.value.sourceTokenField };
    const range = bindingTargetRange(target);
    const field = target.fieldIndex === undefined ? "" : ` ${columnName(range?.left ?? target.fieldIndex + 1)}`;
    return `${target.regionId ? `${target.regionId} · ` : ""}${labels[target.control] ?? m.value.regionCoordinates}${field}`;
  }
  const issueEntries = computed(() => validation.value.issues.map(issue => ({
    issue, label: targetLabel(issueTarget(issue)),
    message: issue.message.replace(/\$\.recipe\.regions\[(\d+)\]/g, (_path, index: string) => regionBindings.recipe.value.regions[Number(index)]?.id ?? m.value.regionProperties),
  })));
  function nextStep(target?: ExcelBindingTarget): string {
    if (!target) return mode.value === "regions" ? m.value.nextRegion : m.value.nextHeader;
    const hints: Record<string, string> = { dataset: m.value.nextDataset, rowKey: m.value.nextRowKey, field: m.value.nextField, fields: m.value.nextField, range: m.value.nextRange, regions: m.value.nextRegion, footer: m.value.nextFooter, header: m.value.nextHeader, detail: m.value.nextHeader, title: m.value.nextHeader };
    return hints[target.control] ?? m.value.nextContract;
  }
  const guidance = computed(() => {
    if (props.readonly) return m.value.readonly;
    if (loading.value) return m.value.loading;
    if (applying.value) return m.value.applying;
    if (applied.value) return m.value.applied;
    if (validation.value.ok) return m.value.ready;
    return nextStep(validation.value.issues[0] ? issueTarget(validation.value.issues[0]) : undefined);
  });
  watch(focusTarget, value => {
    const range = value && bindingTargetRange(value.target);
    if (!range || !sourceRange.value) return;
    row.value = Math.max(sourceRange.value.top, Math.min(sourceRange.value.bottom, range.top));
    column.value = Math.max(sourceRange.value.left, Math.min(sourceRange.value.right, range.left));
  });
  function locateIssue(issue: ExcelBindingIssue): void {
    if (mode.value === "regions") { regionBindings.locate(issue); return; }
    const target = issueTarget(issue), range = bindingTargetRange(target);
    if (range) { anchor.value = range.top; end.value = range.bottom; }
    if (target.fieldIndex !== undefined) mappingPage.value = Math.floor(target.fieldIndex / 12);
    tableFocus.value = { target, sequence: (tableFocus.value?.sequence ?? 0) + 1 };
  }
  const mappings = computed(() =>
    recipe.value.fields
      .slice(mappingPage.value * 12, (mappingPage.value + 1) * 12)
      .map((field, index) => ({
        index: mappingPage.value * 12 + index,
        field,
        physical: columnName(
          (sourceRange.value?.left ?? 1) + mappingPage.value * 12 + index,
        ),
      })),
  );
  const rowKeys = computed(
    () =>
      dataset.value?.fields.filter((field) => field.type !== "boolean") ?? [],
  );
  const selection = computed(() =>
    anchor.value !== undefined && end.value !== undefined
      ? {
          top: Math.min(anchor.value, end.value),
          bottom: Math.max(anchor.value, end.value),
        }
      : undefined,
  );
  let controller: AbortController | undefined;
  let generation = 0;
  function cancel(): void {
    generation++;
    controller?.abort();
    controller = undefined;
    loading.value = false;
  }
  function resetPosition(): void {
    row.value = sourceRange.value?.top ?? 1;
    column.value = sourceRange.value?.left ?? 1;
    anchor.value = undefined;
    end.value = undefined;
    mappingPage.value = 0;
    checked.value = false;
    applied.value = false;
  }
  function loadSession(value: AnyExcelBindingSession): void {
    cancel();
    try {
      const session = value.version === "2.0" ? parseExcelRegionBindingSession(value) : parseExcelBindingSession(value);
      cancel();
      releaseWorkbook();
      sheetChoices.value = session.source.sheets.map((sheet) => ({
        name: sheet.name,
        index: sheet.index,
      }));
      imported.value = session.source;
      clearSheetDrafts();
      if (session.version === "2.0") {
        recipe.value = emptyRecipe(session.recipe.sheet, session.source.sheets.find(sheet => sheet.name === session.recipe.sheet)!.columnCount);
        regionBindings.reset(session.recipe); mode.value = "regions";
      } else { recipe.value = session.recipe; regionBindings.reset(); mode.value = "table"; }
      identity.value = { ...session.identity, ...(props.lockId && props.identity ? { id: props.identity.id } : {}) };
      sourceName.value = session.recipe.sheet;
      error.value = "";
      resetPosition();
      sourceRevision.value++; localDraft.accept();
    } catch (cause) {
      error.value = text(cause);
    }
  }
  watch(
    () => props.session,
    (value) => {
      if (value) loadSession(value);
    },
    { immediate: true },
  );
  watch(
    () => props.readonly,
    (readonly) => {
      if (readonly) { cancel(); releaseWorkbook(); }
    },
  );
  watch(
    [recipe, identity, mode, regionBindings.recipe],
    () => {
      checked.value = false;
      applied.value = false;
    },
    { deep: true, flush: "sync" },
  );
  watch(
    () => props.datasets,
    () => {
      checked.value = false;
      applied.value = false;
    },
  );
  onBeforeUnmount(() => { cancel(); releaseWorkbook(); });
  async function importFile(file: File): Promise<void> {
    if (props.readonly) return;
    cancel();
    if (!/\.xlsx$/i.test(file.name)) {
      error.value = m.value.invalidFile;
      return;
    }
    const job = ++generation;
    controller = new AbortController();
    loading.value = true;
    error.value = "";
    let opened: ExcelWorkbookSession | undefined;
    try {
      const { openExcelWorkbook } = await import("../xlsx/workbook-session");
      if (job !== generation || props.readonly) return;
      opened = await openExcelWorkbook(file, { ...props.importOptions, signal: controller.signal });
      if (job !== generation || props.readonly) return;
      const choices = opened.inspect().sheets.filter((item) => item.visible);
      if (!choices.length) throw new Error("Excel 中没有可导入的可见工作表");
      const targetSheet = pendingMapping?.recipe.sheet || choices[0]!.name;
      if (!choices.some(item => item.name === targetSheet)) throw new Error(m.value.recoveredSheetMissing);
      const result = await opened.importTemplate({ sheets: [targetSheet], signal: controller.signal });
      if (job !== generation || props.readonly) return;
      releaseWorkbook(); workbook = opened; opened = undefined;
      imported.value = result; sourceRevision.value++;
      sourceName.value = file.name;
      sheetChoices.value = choices.map((item) => ({
        name: item.name,
        index: item.index,
      }));
      clearSheetDrafts();
      recipe.value = emptyRecipe(
        result.sheets[0]!.name,
        result.sheets[0]!.columnCount,
      );
      regionBindings.reset();
      if (pendingMapping) { applyRecoveredMapping(pendingMapping); pendingMapping = undefined; recoveredMapping.value = false; }
      resetPosition();
    } catch (cause) {
      if (job === generation) error.value = text(cause);
    } finally {
      opened?.dispose();
      if (job === generation) {
        loading.value = false;
        controller = undefined;
      }
    }
  }
  async function chooseSheet(name: string): Promise<void> {
    if (
      disabled.value ||
      !sheetChoices.value.some((item) => item.name === name) || recipe.value.sheet === name
    )
      return;
    cacheCurrentSheet();
    const selected = imported.value?.sheets.find((item) => item.name === name);
    if (selected) {
      recipe.value = sheetRecipe(name, selected.columnCount);
      regionBindings.reset(regionSheetRecipes.get(name));
      error.value = "";
      resetPosition();
      return;
    }
    if (!workbook || workbook.disposed) return;
    cancel();
    const job = ++generation;
    controller = new AbortController();
    loading.value = true;
    error.value = "";
    try {
      const result = await workbook.importTemplate({ sheets: [name], signal: controller.signal });
      if (job !== generation || props.readonly) return;
      imported.value = result;
      recipe.value = sheetRecipe(name, result.sheets[0]!.columnCount);
      regionBindings.reset(regionSheetRecipes.get(name));
      resetPosition();
    } catch (cause) {
      if (job === generation) error.value = text(cause);
    } finally {
      if (job === generation) {
        loading.value = false;
        controller = undefined;
      }
    }
  }
  function chooseDataset(id: string): void {
    if (disabled.value) return;
    recipe.value.dataset = id;
    recipe.value.rowKey = "";
    recipe.value.fields.fill("");
    checked.value = false;
    applied.value = false;
  }
  function chooseRow(number: number, extend: boolean): void {
    if (
      disabled.value ||
      !sourceRange.value ||
      number < sourceRange.value.top ||
      number > sourceRange.value.bottom
    )
      return;
    if (!extend || anchor.value === undefined) anchor.value = number;
    end.value = number;
  }
  function markRegion(role: ExcelBindingRegion): void {
    if (disabled.value || !imported.value || !selection.value) {
      if (!disabled.value) error.value = m.value.emptySelection;
      return;
    }
    recipe.value.regions[role] = excelBindingRowRange(
      imported.value,
      recipe.value.sheet,
      selection.value.top,
      selection.value.bottom,
    );
    checked.value = false;
    applied.value = false;
    error.value = "";
  }
  function clearRegion(role: "title" | "footer"): void {
    if (!disabled.value) {
      delete recipe.value.regions[role];
      checked.value = false;
      applied.value = false;
    }
  }
  function setMapping(index: number, field: string): void {
    if (!disabled.value && index >= 0 && index < recipe.value.fields.length) {
      recipe.value.fields[index] = field;
      checked.value = false;
      applied.value = false;
    }
  }
  function setRowKey(value: string): void { if (!disabled.value) recipe.value.rowKey = value; }
  function setIdentity(key: "id" | "name", value: string): void { if (!disabled.value && !(key === "id" && props.lockId)) identity.value[key] = value; }
  function regionAt(number: number): ExcelBindingRegion | undefined {
    for (const role of ["title", "header", "detail", "footer"] as const) {
      const range = recipe.value.regions[role];
      if (!range) continue;
      const parsed = parseImportRange(range);
      if (number >= parsed.top && number <= parsed.bottom) return role;
    }
    return undefined;
  }
  function moveWindow(axis: "row" | "column", delta: number): void {
    if (!sourceRange.value) return;
    if (axis === "row")
      row.value = Math.max(
        sourceRange.value.top,
        Math.min(sourceRange.value.bottom, row.value + delta),
      );
    else
      column.value = Math.max(
        sourceRange.value.left,
        Math.min(sourceRange.value.right, column.value + delta),
      );
  }
  function restoreDraft(): void {
    if (props.readonly) return;
    if (props.session) { loadSession(props.session); return; }
    pendingMapping = undefined; recoveredMapping.value = false;
    cancel(); releaseWorkbook(); imported.value = undefined; sheetChoices.value = []; sourceName.value = "";
    clearSheetDrafts();
    recipe.value = emptyRecipe(); identity.value = { id: props.identity?.id ?? "excel-template", name: props.identity?.name ?? "Excel 业务模板" };
    regionBindings.reset(); mode.value = "table";
    resetPosition(); sourceRevision.value++; localDraft.accept(); error.value = "";
  }
  function check(): void {
    if (!canCheck.value) return;
    checked.value = true;
    error.value = "";
  }
  async function apply(): Promise<void> {
    if (disabled.value || !imported.value || recoveredMapping.value) return;
    checked.value = true;
    error.value = "";
    if (!validation.value.ok) return;
    applying.value = true;
    try {
      const targetIdentity = { ...identity.value, ...(props.lockId && props.identity ? { id: props.identity.id } : {}) };
      const result = mode.value === "regions"
        ? createExcelRegionBindingDocument(imported.value, regionBindings.recipe.value, props.datasets, targetIdentity)
        : createExcelBindingDocument(imported.value, recipe.value, props.datasets, targetIdentity);
      const session = mode.value === "regions"
        ? createExcelRegionBindingSession(imported.value, regionBindings.recipe.value, targetIdentity)
        : createExcelBindingSession(imported.value, recipe.value, targetIdentity);
      const resultWithSession = { ...result, session };
      const before = localDraft.snapshot();
      if (props.accept && !await props.accept(resultWithSession)) return;
      if (props.readonly) return;
      if (before !== localDraft.snapshot() && localDraft.pending.value) return;
      if (!props.accept) emit(resultWithSession);
      clearSheetDrafts();
      localDraft.accept();
      applied.value = true;
    } catch (cause) {
      error.value = text(cause);
    } finally { applying.value = false; }
  }
  useTemplateToolDraft({ key: () => "excel", baseline: () => "declarations-only", pending: () => localDraft.pending.value || recoveredMapping.value, snapshot: () => JSON.stringify(declaration()), restore(value) {
    const state = JSON.parse(value) as MappingDeclaration;
    if (!state.recipe || !state.regions || !Array.isArray(state.cached?.table) || !Array.isArray(state.cached?.regions)) throw new Error("Invalid Excel mapping draft");
    applyRecoveredMapping(state); pendingMapping = state; recoveredMapping.value = true;
  } });
  return {
    recoveredMapping,
    imported,
    mode, regionBindings,
    pendingLocalChanges: computed(() => localDraft.pending.value || recoveredMapping.value),
    recipe,
    identity,
    sourceName,
    sheetChoices,
    error,
    loading,
    checked,
    applied,
    row,
    column,
    mappingPage,
    m,
    disabled,
    canCheck,
    sheet,
    sourceRange,
    dataset,
    window,
    validation,
    focusTarget, issueEntries, guidance, locateIssue,
    mappings,
    rowKeys,
    selection,
    cancel,
    importFile,
    chooseSheet,
    chooseDataset,
    chooseRow,
    markRegion,
    clearRegion,
    setMapping,
    setRowKey, setIdentity,
    regionAt,
    moveWindow,
    check,
    restoreDraft,
    apply,
  };
}
