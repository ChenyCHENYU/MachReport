import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
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
  type ExcelBindingDocumentResult,
  type ExcelBindingRecipe,
  type ExcelBindingRegion,
  type ExcelBindingSession,
} from "../xlsx/binding-workflow";
import {
  EXCEL_BINDING_MESSAGES,
  type ExcelBindingMessages,
} from "./excel-binding-messages";

export interface ExcelBindingWizardApply extends ExcelBindingDocumentResult {
  session: ExcelBindingSession;
}
export interface ExcelBindingWizardOptions {
  datasets: readonly ExcelBindingDataset[];
  /** An embedded editor can decline replacement; success is shown only after acceptance. */
  accept?: (result: ExcelBindingWizardApply) => boolean | Promise<boolean>;
  /** Source + exact coordinates + mappings. No File, functions, network credentials, or live result rows. */
  session?: ExcelBindingSession;
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
  const sheetRecipes = new Map<string, ExcelBindingRecipe>();
  const cloneRecipe = (value: ExcelBindingRecipe) => JSON.parse(JSON.stringify(value)) as ExcelBindingRecipe;
  function sheetRecipe(name: string, columns: number): ExcelBindingRecipe { return cloneRecipe(sheetRecipes.get(name) ?? emptyRecipe(name, columns)); }
  const identity = ref({
    id: props.identity?.id ?? "excel-template",
    name: props.identity?.name ?? "Excel 业务模板",
  });
  const sourceName = ref("");
  const sourceRevision = ref(0);
  const localDraft = useLocalDraft(() => ({ source: sourceRevision.value, recipe: recipe.value, identity: identity.value }));
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
  const validation = computed(() => {
    if (!imported.value) return { ok: false, issues: [], mapped: 0, total: 0 };
    const result = validateExcelBindingFields(
      imported.value,
      recipe.value,
      props.datasets,
    );
    const issues = [...regionIssues.value, ...result.issues];
    return { ...result, ok: issues.length === 0, issues };
  });
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
  function loadSession(value: ExcelBindingSession): void {
    cancel();
    try {
      const session = parseExcelBindingSession(value);
      cancel();
      releaseWorkbook();
      sheetChoices.value = session.source.sheets.map((sheet) => ({
        name: sheet.name,
        index: sheet.index,
      }));
      imported.value = session.source;
      sheetRecipes.clear();
      recipe.value = session.recipe;
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
    [recipe, identity],
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
      const result = await opened.importTemplate({ sheets: [choices[0]!.name], signal: controller.signal });
      if (job !== generation || props.readonly) return;
      releaseWorkbook(); workbook = opened; opened = undefined;
      imported.value = result; sourceRevision.value++;
      sourceName.value = file.name;
      sheetChoices.value = choices.map((item) => ({
        name: item.name,
        index: item.index,
      }));
      sheetRecipes.clear();
      recipe.value = emptyRecipe(
        result.sheets[0]!.name,
        result.sheets[0]!.columnCount,
      );
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
      !sheetChoices.value.some((item) => item.name === name)
    )
      return;
    if (recipe.value.sheet) sheetRecipes.set(recipe.value.sheet, cloneRecipe(recipe.value));
    const selected = imported.value?.sheets.find((item) => item.name === name);
    if (selected) {
      recipe.value = sheetRecipe(name, selected.columnCount);
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
    cancel(); releaseWorkbook(); imported.value = undefined; sheetChoices.value = []; sourceName.value = "";
    sheetRecipes.clear();
    recipe.value = emptyRecipe(); identity.value = { id: props.identity?.id ?? "excel-template", name: props.identity?.name ?? "Excel 业务模板" };
    resetPosition(); sourceRevision.value++; localDraft.accept(); error.value = "";
  }
  function check(): void {
    checked.value = true;
    error.value = "";
  }
  async function apply(): Promise<void> {
    if (disabled.value || !imported.value) return;
    checked.value = true;
    error.value = "";
    if (!validation.value.ok) return;
    applying.value = true;
    try {
      const targetIdentity = { ...identity.value, ...(props.lockId && props.identity ? { id: props.identity.id } : {}) };
      const result = createExcelBindingDocument(
        imported.value,
        recipe.value,
        props.datasets,
        targetIdentity,
      );
      const session = createExcelBindingSession(
        imported.value,
        recipe.value,
        targetIdentity,
      );
      const resultWithSession = { ...result, session };
      const before = localDraft.snapshot();
      if (props.accept && !await props.accept(resultWithSession)) return;
      if (props.readonly) return;
      if (before !== localDraft.snapshot() && localDraft.pending.value) return;
      if (!props.accept) emit(resultWithSession);
      localDraft.accept();
      sheetRecipes.clear();
      applied.value = true;
    } catch (cause) {
      error.value = text(cause);
    } finally { applying.value = false; }
  }
  return {
    imported,
    pendingLocalChanges: localDraft.pending,
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
    sheet,
    sourceRange,
    dataset,
    window,
    validation,
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
    regionAt,
    moveWindow,
    check,
    restoreDraft,
    apply,
  };
}
