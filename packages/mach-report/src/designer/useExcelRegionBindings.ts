import { computed, ref, type Ref, type ShallowRef } from "vue";
import type { ExcelImportResult } from "../xlsx/import-types";
import type { ExcelBindingDataset } from "../xlsx/binding-workflow";
import { excelBindingCellRange, validateExcelRegionFields, validateExcelRegionGeometry, type ExcelRegionBindingRecipe } from "../xlsx/region-binding-workflow";

export function emptyRegionRecipe(sheet = ""): ExcelRegionBindingRecipe { return { version: "2.0", sheet, regions: [] }; }
export function useExcelRegionBindings(imported: ShallowRef<ExcelImportResult | undefined>, sheetName: Ref<string>, disabled: Ref<boolean>, datasets: () => readonly ExcelBindingDataset[]) {
  const recipe = ref(emptyRegionRecipe()), activeId = ref("");
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
  function reset(value = emptyRegionRecipe(sheetName.value)): void { recipe.value = JSON.parse(JSON.stringify(value)) as ExcelRegionBindingRecipe; activeId.value = recipe.value.regions[0]?.id ?? ""; from.value = undefined; to.value = undefined; }
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
  function header(): void { if (!disabled.value && active.value && selection.value) active.value.headerRange = selection.value; }
  function footer(): void { if (!disabled.value && selection.value) recipe.value.footerRange = selection.value; }
  function clearFooter(): void { if (!disabled.value) delete recipe.value.footerRange; }
  function setActive(id: string): void { if (recipe.value.regions.some(region => region.id === id)) activeId.value = id; }
  function selected(row: number, column: number): boolean {
    return !!from.value && !!to.value && row >= Math.min(from.value.row, to.value.row) && row <= Math.max(from.value.row, to.value.row) && column >= Math.min(from.value.column, to.value.column) && column <= Math.max(from.value.column, to.value.column);
  }
  return { recipe, activeId, active, selection, validation, reset, select, add, remove, dataset, header, footer, clearFooter, setActive, selected };
}
