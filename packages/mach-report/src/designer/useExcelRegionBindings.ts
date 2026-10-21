import { computed, ref, type Ref, type ShallowRef } from "vue";
import type { ExcelImportResult } from "../xlsx/import-types";
import type { ExcelBindingDataset } from "../xlsx/binding-workflow";
import { excelBindingCellRange, validateExcelRegionFields, validateExcelRegionGeometry, type ExcelRegionBindingRecipe } from "../xlsx/region-binding-workflow";
import { bindingTargetRange, excelRegionIssueRegionIds, excelRegionIssueTarget, isIncompleteRegionIssue, type ExcelBindingTarget } from "./excel-binding-guidance";
import type { ExcelBindingIssue } from "../xlsx/binding-workflow";

export function emptyRegionRecipe(sheet = ""): ExcelRegionBindingRecipe { return { version: "2.0", sheet, regions: [] }; }
export function useExcelRegionBindings(imported: ShallowRef<ExcelImportResult | undefined>, sheetName: Ref<string>, disabled: Ref<boolean>, datasets: () => readonly ExcelBindingDataset[]) {
  const recipe = ref(emptyRegionRecipe()), activeId = ref("");
  const focusTarget = ref<{ target: ExcelBindingTarget; sequence: number }>();
  const from = ref<{ row: number; column: number }>(), to = ref<{ row: number; column: number }>();
  const selection = computed(() => {
    if (!imported.value || !from.value || !to.value) return "";
    return excelBindingCellRange(imported.value, sheetName.value, from.value, to.value);
  });
  const geometryRecipe = computed(() => ({ ...recipe.value, regions: recipe.value.regions.map(region => ({ ...region, fields: [] })) }));
  const geometry = computed(() => imported.value ? validateExcelRegionGeometry(imported.value, geometryRecipe.value) : []);
  const validation = computed(() => {
    const fields = validateExcelRegionFields(recipe.value, datasets()), issues = [...geometry.value, ...fields.issues];
    return { ...fields, ok: !issues.length, issues };
  });
  const active = computed(() => recipe.value.regions.find(region => region.id === activeId.value));
  function target(issue: ExcelBindingIssue): ExcelBindingTarget { return excelRegionIssueTarget(issue, recipe.value, datasets()); }
  const directory = computed(() => {
    const byRegion = new Map<string, { issue: ExcelBindingIssue; target: ExcelBindingTarget }[]>();
    for (const issue of validation.value.issues) {
      const resolved = target(issue);
      for (const id of excelRegionIssueRegionIds(issue, recipe.value, datasets())) {
        const entries = byRegion.get(id) ?? []; entries.push({ issue, target: { ...resolved, regionId: id } }); byRegion.set(id, entries);
      }
    }
    return recipe.value.regions.map(region => {
      const issues = byRegion.get(region.id) ?? [];
      const state = !issues.length ? "ready" : issues.every(item => isIncompleteRegionIssue(item.issue, item.target, region)) ? "pending" : "error";
      return { region, state, issues };
    });
  });
  function reset(value = emptyRegionRecipe(sheetName.value)): void { recipe.value = JSON.parse(JSON.stringify(value)) as ExcelRegionBindingRecipe; activeId.value = recipe.value.regions[0]?.id ?? ""; from.value = undefined; to.value = undefined; focusTarget.value = undefined; }
  function locateTarget(value: ExcelBindingTarget): void {
    if (value.regionId) activeId.value = value.regionId;
    const range = bindingTargetRange(value);
    if (range) { from.value = { row: range.top, column: range.left }; to.value = { row: range.bottom, column: range.right }; }
    focusTarget.value = { target: value, sequence: (focusTarget.value?.sequence ?? 0) + 1 };
  }
  function locate(issue: ExcelBindingIssue): void { locateTarget(target(issue)); }
  function select(row: number, column: number, extend: boolean): void {
    if (disabled.value) return;
    if (!extend || !from.value) from.value = { row, column };
    to.value = { row, column };
  }
  function add(): void {
    if (disabled.value || !selection.value || recipe.value.regions.length >= 128) return;
    let sequence = 1;
    while (recipe.value.regions.some(region => region.id === `region-${sequence}`)) sequence++;
    const id = `region-${sequence}`, width = Math.abs(to.value!.column - from.value!.column) + 1;
    recipe.value.regions.push({ id, range: selection.value, mode: "repeat", dataset: "", fields: Array.from({ length: width }, () => ""), rowKey: "" });
    activeId.value = id;
  }
  function remove(id: string): void {
    if (disabled.value) return;
    recipe.value.regions = recipe.value.regions.filter(region => region.id !== id);
    if (activeId.value === id) activeId.value = recipe.value.regions[0]?.id ?? "";
  }
  function dataset(id: string): void {
    if (!disabled.value && active.value) { active.value.dataset = id; active.value.rowKey = ""; active.value.fields.fill(""); delete active.value.revisionField; delete active.value.sourceTokenField; }
  }
  function property(key: "mode" | "rowKey" | "revisionField" | "sourceTokenField", value: string): void {
    if (disabled.value || !active.value) return;
    if (key === "mode") { if (value === "record" || value === "repeat") active.value.mode = value; return; }
    if (value || key === "rowKey") active.value[key] = value;
    else delete active.value[key];
  }
  function mapping(index: number, value: string): void {
    if (!disabled.value && active.value && index >= 0 && index < active.value.fields.length) active.value.fields[index] = value;
  }
  function clearHeader(): void { if (!disabled.value && active.value) delete active.value.headerRange; }
  function header(): void { if (!disabled.value && active.value && selection.value) active.value.headerRange = selection.value; }
  function footer(): void { if (!disabled.value && selection.value) recipe.value.footerRange = selection.value; }
  function clearFooter(): void { if (!disabled.value) delete recipe.value.footerRange; }
  function setActive(id: string): void {
    const region = recipe.value.regions.find(item => item.id === id);
    if (region) locateTarget({ regionId: id, control: "range", range: region.range });
  }
  function selected(row: number, column: number): boolean {
    return !!from.value && !!to.value && row >= Math.min(from.value.row, to.value.row) && row <= Math.max(from.value.row, to.value.row) && column >= Math.min(from.value.column, to.value.column) && column <= Math.max(from.value.column, to.value.column);
  }
  return { recipe, activeId, active, selection, validation, directory, focusTarget, target, locate, reset, select, add, remove, dataset, property, mapping, header, clearHeader, footer, clearFooter, setActive, selected };
}
