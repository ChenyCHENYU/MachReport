<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { bindingTargetRange } from "./excel-binding-guidance";
import ExcelRegionBindingPanel from "./ExcelRegionBindingPanel.vue";
import ReportIcon from "../vue/ReportIcon.vue";
import type { ExcelBindingRegion } from "../xlsx/binding-workflow";
import {
  useExcelBindingWizard,
  type ExcelBindingWizardOptions,
  type ExcelBindingWizardApply,
} from "./useExcelBindingWizard";

const props = defineProps<ExcelBindingWizardOptions>();
const emit = defineEmits<{
  (event: "apply", result: ExcelBindingWizardApply): void;
  (event: "dirty", value: boolean): void;
}>();
const wizard = useExcelBindingWizard(props, (result) => emit("apply", result));
const {
  imported,
  mode, regionBindings,
  recipe,
  identity,
  sourceName,
  sheetChoices,
  error,
  loading,
  checked,
  row,
  column,
  mappingPage,
  m,
  disabled,
  sheet,
  sourceRange,
  dataset,
  window: viewport,
  validation,
  mappings,
  rowKeys,
  selection,
} = wizard;
watch([wizard.pendingLocalChanges, recipe, identity], () => emit("dirty", wizard.pendingLocalChanges.value), { immediate: true, deep: true, flush: "sync" });
const input = ref<HTMLInputElement>();
const element = ref<HTMLElement>();
const issuePage = ref(0);
const issuePages = computed(() => Math.max(1, Math.ceil(wizard.issueEntries.value.length / 12)));
const visibleIssues = computed(() => wizard.issueEntries.value.slice(issuePage.value * 12, (issuePage.value + 1) * 12));
watch(issuePages, count => { issuePage.value = Math.min(issuePage.value, count - 1); });
watch(wizard.focusTarget, async value => {
  if (!value) return;
  await nextTick();
  const range = bindingTargetRange(value.target);
  if (range) element.value?.querySelector<HTMLElement>(`td[data-source-cell="${range.top}:${range.left}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  if (mode.value === "regions") return;
  const control = value.target.control === "field" ? `field-${value.target.fieldIndex}` : value.target.control === "contract" ? "dataset" : value.target.control;
  const target = element.value?.querySelector<HTMLElement>(`.mr-binding-table-editor [data-binding-control="${control}"]`);
  const focus = disabled.value ? target?.closest<HTMLElement>("label") : target;
  focus?.focus(); focus?.scrollIntoView?.({ block: "nearest" });
});
const dragging = ref(false);
const regions: ExcelBindingRegion[] = ["title", "header", "detail", "footer"];
const regionLabel = computed(() => ({
  title: m.value.titleRegion,
  header: m.value.headerRegion,
  detail: m.value.detailRegion,
  footer: m.value.footerRegion,
}));
const mappingCount = computed(() =>
  Math.max(1, Math.ceil(recipe.value.fields.length / 12)),
);
function value(event: Event): string {
  return (event.target as HTMLInputElement).value;
}
function upload(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) void wizard.importFile(file);
  target.value = "";
}
function pointerRow(event: PointerEvent, number: number): void {
  if (event.button !== 0 || disabled.value) return;
  event.preventDefault();
  dragging.value = true;
  wizard.chooseRow(number, event.shiftKey);
  if (mode.value === "regions" && sourceRange.value) { regionBindings.select(number, sourceRange.value.left, false); regionBindings.select(number, sourceRange.value.right, true); }
  (event.currentTarget as HTMLElement).focus();
}
function pointerCell(event: PointerEvent, sourceRow: number, sourceColumn: number): void {
  if (mode.value !== "regions" || event.button !== 0 || disabled.value) return;
  event.preventDefault(); dragging.value = true;
  regionBindings.select(sourceRow, sourceColumn, event.shiftKey);
  (event.currentTarget as HTMLElement).focus();
}
function cellKeydown(event: KeyboardEvent, sourceRow: number, sourceColumn: number): void {
  if (mode.value !== "regions") return;
  if (event.key === " " || event.key === "Enter") { event.preventDefault(); regionBindings.select(sourceRow, sourceColumn, event.shiftKey); }
  const deltas: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const delta = deltas[event.key];
  if (!delta || !sourceRange.value) return;
  event.preventDefault();
  const nextRow = Math.max(sourceRange.value.top, Math.min(sourceRange.value.bottom, sourceRow + delta[0]));
  const nextColumn = Math.max(sourceRange.value.left, Math.min(sourceRange.value.right, sourceColumn + delta[1]));
  if (event.shiftKey) regionBindings.select(nextRow, nextColumn, true);
  (event.currentTarget as HTMLElement).closest("table")?.querySelector<HTMLElement>(`td[data-source-cell="${nextRow}:${nextColumn}"]`)?.focus();
}
function rowKeydown(event: KeyboardEvent, number: number): void {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    wizard.chooseRow(number, event.shiftKey);
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = number + (event.key === "ArrowDown" ? 1 : -1);
    if (event.shiftKey) wizard.chooseRow(next, true);
    (event.currentTarget as HTMLElement)
      .closest("table")
      ?.querySelector<HTMLButtonElement>(`button[data-source-row="${next}"]`)
      ?.focus();
  }
}
function fieldInfo(fieldName: string): string {
  const field = dataset.value?.fields.find((item) => item.field === fieldName);
  if (!field) return "";
  return [
    field.type,
    field.unit,
    field.digits === undefined
      ? undefined
      : `${field.digits}${m.value.precision}`,
    field.sample === undefined
      ? undefined
      : `${m.value.sample}: ${String(field.sample)}`,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");
}
function number(event: Event, axis: "row" | "column"): void {
  const parsed = Number(value(event));
  if (!Number.isInteger(parsed) || !sourceRange.value) return;
  if (axis === "row")
    row.value = Math.max(
      sourceRange.value.top,
      Math.min(sourceRange.value.bottom, parsed),
    );
  else
    column.value = Math.max(
      sourceRange.value.left,
      Math.min(sourceRange.value.right, parsed),
    );
}
defineExpose({
  get pendingLocalChanges() { return wizard.pendingLocalChanges.value; },
  importFile: wizard.importFile,
  apply: wizard.apply,
  cancel: wizard.cancel,
});
</script>

<template>
  <section
    ref="element"
    class="mr-binding"
    :aria-label="m.title"
    :aria-busy="loading"
    @pointerup="dragging = false"
    @pointercancel="dragging = false"
    @pointerleave="dragging = false"
  >
    <header class="mr-binding-bar">
      <div class="mr-binding-heading">
        <ReportIcon name="file" :size="17" /><strong>{{ m.title }}</strong><span>{{ sourceName || m.intro }}</span>
      </div>
      <input
        ref="input"
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        :aria-label="m.upload"
        class="mr-binding-file"
        :disabled="readonly"
        @change="upload"
      />
      <button v-if="loading" type="button" @click="wizard.cancel">
        {{ m.cancel }}
      </button>
      <button v-else type="button" :disabled="readonly" @click="input?.click()">
        <ReportIcon name="upload" :size="14" />{{
          imported ? m.replace : m.upload
        }}
      </button>
    </header>
    <div v-if="error" class="mr-binding-error" role="alert">{{ error }}</div>
    <div v-if="loading" class="mr-binding-placeholder" role="status">
      <span class="mr-binding-loader"></span>{{ m.loading }}
    </div>
    <div v-else-if="!imported" class="mr-binding-placeholder">
      <svg viewBox="0 0 80 80" fill="none" aria-hidden="true">
        <rect
          x="15"
          y="10"
          width="50"
          height="60"
          rx="8"
          fill="#eff6ff"
          stroke="#bfdbfe"
        />
        <path
          d="M25 25h30M25 35h30M25 45h30M35 25v30M45 25v30M25 55h30"
          stroke="#93c5fd"
          stroke-width="1.5"
        />
      </svg>
      <strong>{{ m.noSource }}</strong><span>{{ m.sourceOnly }}</span>
      <button
        type="button"
        class="mr-binding-primary"
        :disabled="readonly"
        @click="input?.click()"
      >
        {{ m.upload }}
      </button>
    </div>
    <template v-else>
      <div class="mr-binding-sourcebar">
        <label>{{ m.sheet
          }}<select
            :value="recipe.sheet"
            :aria-label="m.sheet"
            :disabled="disabled"
            @change="wizard.chooseSheet(value($event))"
          >
            <option
              v-for="item in sheetChoices"
              :key="item.name"
              :value="item.name"
            >
              {{ item.name }}
            </option>
          </select></label>
        <div class="mr-binding-mode" role="group" :aria-label="m.regionMode"><button type="button" :aria-pressed="mode === 'table'" :disabled="disabled" @click="mode = 'table'">{{ m.tableMode }}</button><button type="button" :aria-pressed="mode === 'regions'" :disabled="disabled" @click="mode = 'regions'"><ReportIcon name="grid" :size="12" />{{ m.multiRegions }}</button></div>
        <span class="mr-binding-range">{{ sheet?.range }} · {{ sheet?.rowCount }} ×
          {{ sheet?.columnCount }}</span>
        <span class="mr-binding-sample-note">{{ m.sourceOnly }}</span>
      </div>
      <div class="mr-binding-layout">
        <div class="mr-binding-source">
          <div class="mr-binding-grid-heading">
            <strong>{{ m.source }}</strong><span>{{ mode === "regions" ? m.multiHint : m.sourceHint }}</span>
          </div>
          <div
            v-if="viewport"
            class="mr-binding-grid-scroll"
            :aria-label="m.source"
          >
            <table class="mr-binding-grid">
              <thead>
                <tr>
                  <th class="mr-binding-corner" aria-label="#">#</th>
                  <th
                    v-for="item in viewport.columns"
                    :key="item.column"
                    scope="col"
                  >
                    {{ item.name }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in viewport.rows"
                  :key="item.row"
                  :data-region="wizard.regionAt(item.row)"
                  :class="{
                    'is-selected':
                      selection &&
                      item.row >= selection.top &&
                      item.row <= selection.bottom,
                  }"
                >
                  <th scope="row">
                    <button
                      type="button"
                      :data-source-row="item.row"
                      :aria-label="`${m.selectionLabel} ${item.row}`"
                      :aria-pressed="
                        !!selection &&
                        item.row >= selection.top &&
                        item.row <= selection.bottom
                      "
                      :disabled="disabled"
                      @pointerdown="pointerRow($event, item.row)"
                      @pointerenter="
                        dragging && wizard.chooseRow(item.row, true)
                      "
                      @keydown="rowKeydown($event, item.row)"
                    >
                      {{ item.row }}
                    </button>
                  </th>
                  <td
                    v-for="cell in item.cells"
                    :key="cell.column"
                    :rowspan="cell.rowSpan"
                    :colspan="cell.colSpan"
                    :title="`${cell.address} · ${cell.text}`"
                    :data-source-cell="`${cell.row}:${cell.column}`"
                    :tabindex="mode === 'regions' ? 0 : undefined"
                    :aria-label="mode === 'regions' ? `${m.selectionCellLabel} ${cell.address}` : undefined"
                    :aria-selected="mode === 'regions' ? regionBindings.selected(cell.row, cell.column) : undefined"
                    :class="{ 'is-continued': cell.continued, 'is-cell-selected': mode === 'regions' && regionBindings.selected(cell.row, cell.column) }"
                    @pointerdown="pointerCell($event, cell.row, cell.column)"
                    @pointerenter="mode === 'regions' && dragging && regionBindings.select(cell.row, cell.column, true)"
                    @keydown="cellKeydown($event, cell.row, cell.column)"
                    :style="{
                      textAlign: cell.style?.align,
                      fontWeight: cell.style?.bold ? '600' : undefined,
                    }"
                  >
                    <span>{{ cell.text }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <footer v-if="viewport" class="mr-binding-grid-footer">
            <span>{{ m.selected }}
              <strong>{{
                mode === "regions" ? regionBindings.selection.value || "—" : selection ? `${selection.top}–${selection.bottom}` : "—"
              }}</strong></span>
            <div class="mr-binding-window">
              <button
                type="button"
                :aria-label="m.previousRows"
                :disabled="viewport.top <= viewport.source.top"
                @click="wizard.moveWindow('row', -24)"
              >
                <ReportIcon name="chevron-left" :size="13" />
</button><label>{{ m.rowStart
                }}<input
                  type="number"
                  :min="viewport.source.top"
                  :max="viewport.source.bottom"
                  :value="row"
                  :aria-label="m.rowStart"
                  @change="number($event, 'row')"
/></label><button
                type="button"
                :aria-label="m.nextRows"
                :disabled="viewport.bottom >= viewport.source.bottom"
                @click="wizard.moveWindow('row', 24)"
              >
                <ReportIcon name="chevron-right" :size="13" />
              </button>
            </div>
            <div class="mr-binding-window">
              <button
                type="button"
                :aria-label="m.previousColumns"
                :disabled="viewport.left <= viewport.source.left"
                @click="wizard.moveWindow('column', -12)"
              >
                <ReportIcon name="chevron-left" :size="13" />
</button><label>{{ m.columnStart
                }}<input
                  type="number"
                  :min="viewport.source.left"
                  :max="viewport.source.right"
                  :value="column"
                  :aria-label="m.columnStart"
                  @change="number($event, 'column')"
/></label><button
                type="button"
                :aria-label="m.nextColumns"
                :disabled="viewport.right >= viewport.source.right"
                @click="wizard.moveWindow('column', 12)"
              >
                <ReportIcon name="chevron-right" :size="13" />
              </button>
            </div>
          </footer>
        </div>
        <div class="mr-binding-inspector">
          <ExcelRegionBindingPanel v-if="mode === 'regions'" :controller="regionBindings" :datasets="datasets" :disabled="disabled" :messages="m" />
          <fieldset v-show="mode === 'table'" :disabled="disabled" class="mr-binding-table-editor">
            <section class="mr-binding-group">
              <h3><b>1</b>{{ m.regionLegend }}</h3>
              <div
                v-for="role in regions"
                :key="role"
                class="mr-binding-region"
                :data-role="role"
              >
                <div>
                  <strong>{{ regionLabel[role]
                    }}<small v-if="role === 'title' || role === 'footer'">{{
                      m.optional
                    }}</small></strong><code>{{ recipe.regions[role] || m.unnamed }}</code>
                </div>
                <button
                  type="button"
                  :aria-label="`${m.selectRegion} · ${regionLabel[role]}`"
                  :data-binding-control="role"
                  :title="!selection ? m.emptySelection : `${m.selectRegion} · ${regionLabel[role]}`"
                  :disabled="!selection"
                  @click="wizard.markRegion(role)"
                >
                  <ReportIcon name="arrow-right" :size="13" />
</button><button
                  v-if="
                    (role === 'title' || role === 'footer') &&
                    recipe.regions[role]
                  "
                  type="button"
                  :aria-label="`${m.clear} · ${regionLabel[role]}`"
                  @click="wizard.clearRegion(role)"
                >
                  <ReportIcon name="close" :size="13" />
                </button>
              </div>
              <p v-if="recipe.regions.footer" class="mr-binding-note">
                {{ m.footerHint }}
              </p>
            </section>
            <section class="mr-binding-group">
              <h3>
                <b>2</b>{{ m.mapping
                }}<span>{{ validation.mapped }}/{{ validation.total }}</span>
              </h3>
              <label class="mr-binding-label" tabindex="-1">{{ m.dataset
                }}<select
                  data-binding-control="dataset"
                  :value="recipe.dataset"
                  :aria-label="m.dataset"
                  @change="wizard.chooseDataset(value($event))"
                >
                  <option value="">{{ m.chooseDataset }}</option>
                  <option
                    v-for="item in datasets"
                    :key="item.id"
                    :value="item.id"
                  >
                    {{ item.label || item.id }}
                  </option>
                </select></label>
              <p v-if="!datasets.length" class="mr-binding-note">
                {{ m.noContract }}
              </p>
              <label v-if="dataset" class="mr-binding-label" tabindex="-1">{{ m.rowKey
                }}<select data-binding-control="rowKey" :value="recipe.rowKey" :aria-label="m.rowKey" @change="wizard.setRowKey(value($event))">
                  <option value="">{{ m.chooseRowKey }}</option>
                  <option
                    v-for="field in rowKeys"
                    :key="field.field"
                    :value="field.field"
                  >
                    {{ field.label || field.field }} · {{ field.field }}
                  </option>
                </select></label>
              <div v-if="dataset" class="mr-binding-mappings">
                <label
                  v-for="item in mappings"
                  :key="item.index"
                  class="mr-binding-map"
                  tabindex="-1"
                  ><span>{{ item.physical }}</span>
                  <div>
                    <select
                      :data-binding-control="`field-${item.index}`"
                      :aria-label="`${m.physical} ${item.physical} · ${m.business}`"
                      :value="item.field"
                      @change="wizard.setMapping(item.index, value($event))"
                    >
                      <option value="">{{ m.chooseField }}</option>
                      <option
                        v-for="field in dataset.fields"
                        :key="field.field"
                        :value="field.field"
                      >
                        {{ field.label || field.field }} · {{ field.field }}
                      </option></select><small v-if="item.field">{{
                      fieldInfo(item.field)
                    }}</small>
                  </div></label>
              </div>
              <div
                v-if="dataset && mappingCount > 1"
                class="mr-binding-map-pages"
              >
                <button
                  type="button"
                  :disabled="mappingPage <= 0"
                  :aria-label="m.previousColumns"
                  @click="mappingPage--"
                >
                  <ReportIcon name="chevron-left" :size="13" />
</button><span>{{ mappingPage + 1 }} / {{ mappingCount }}</span><button
                  type="button"
                  :disabled="mappingPage + 1 >= mappingCount"
                  :aria-label="m.nextColumns"
                  @click="mappingPage++"
                >
                  <ReportIcon name="chevron-right" :size="13" />
                </button>
              </div>
            </section>
          </fieldset>
          <fieldset :disabled="disabled">
            <section class="mr-binding-group">
              <h3>{{ m.identity }}</h3>
              <label class="mr-binding-label">{{ m.templateId
                }}<input :value="lockId ? props.identity?.id ?? identity.id : identity.id" autocomplete="off" :readonly="lockId" @input="wizard.setIdentity('id', value($event))" /></label><label class="mr-binding-label">{{ m.templateName
                }}<input :value="identity.name" autocomplete="off" @input="wizard.setIdentity('name', value($event))" /></label>
            </section>
          </fieldset>
        </div>
      </div>
      <details
        v-if="checked && validation.issues.length"
        class="mr-binding-issues"
        open
      >
        <summary>{{ m.issues }} · {{ validation.issues.length }} {{ m.errors }}</summary>
        <ul>
          <li
            v-for="entry in visibleIssues"
            :key="`${entry.issue.path}:${entry.issue.message}`"
          >
            <button type="button" class="mr-binding-issue-link" :aria-label="`${m.locateIssue} · ${entry.label}`" @click="wizard.locateIssue(entry.issue)"><strong>{{ entry.label }}</strong><span>{{ entry.message }}</span><ReportIcon name="arrow-right" :size="12" /></button>
          </li>
        </ul>
        <div v-if="issuePages > 1" class="mr-binding-issue-pages"><button type="button" :disabled="issuePage === 0" :aria-label="m.previousIssues" @click="issuePage--"><ReportIcon name="chevron-left" :size="12" /></button><span>{{ issuePage + 1 }}/{{ issuePages }}</span><button type="button" :disabled="issuePage + 1 >= issuePages" :aria-label="m.nextIssues" @click="issuePage++"><ReportIcon name="chevron-right" :size="12" /></button></div>
      </details>
      <details v-if="imported.warnings.length" class="mr-binding-warnings">
        <summary>
          {{ m.inspectWarning }} · {{ imported.warnings.length }}
        </summary>
        <ul>
          <li v-for="(warning, index) in imported.warnings" :key="index">
            {{ warning }}
          </li>
        </ul>
      </details>
      <footer class="mr-binding-actions">
        <span :class="{ 'is-ready': validation.ok }" role="status" :title="wizard.guidance.value">{{ wizard.guidance.value }}</span><button v-if="wizard.pendingLocalChanges.value" type="button" :disabled="disabled" @click="wizard.restoreDraft">{{ m.restoreDraft }}</button><button type="button" :disabled="!wizard.canCheck.value" @click="wizard.check">
          {{ m.check }}
</button><button
          type="button"
          class="mr-binding-primary"
          :disabled="disabled || !validation.ok"
          :title="wizard.guidance.value"
          @click="wizard.apply"
        >
          {{ m.apply }}
        </button>
      </footer>
    </template>
  </section>
</template>

<style src="./excel-binding.css"></style>
