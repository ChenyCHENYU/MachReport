<script setup lang="ts">
import { computed, ref } from "vue";
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
}>();
const wizard = useExcelBindingWizard(props, (result) => emit("apply", result));
const {
  imported,
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
  window: viewport,
  validation,
  mappings,
  rowKeys,
  selection,
} = wizard;
const input = ref<HTMLInputElement>();
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
  (event.currentTarget as HTMLElement).focus();
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
  importFile: wizard.importFile,
  apply: wizard.apply,
  cancel: wizard.cancel,
});
</script>

<template>
  <section
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
        <span class="mr-binding-range">{{ sheet?.range }} · {{ sheet?.rowCount }} ×
          {{ sheet?.columnCount }}</span>
        <span class="mr-binding-sample-note">{{ m.sourceOnly }}</span>
      </div>
      <div class="mr-binding-layout">
        <div class="mr-binding-source">
          <div class="mr-binding-grid-heading">
            <strong>{{ m.source }}</strong><span>{{ m.sourceHint }}</span>
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
                    :class="{ 'is-continued': cell.continued }"
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
                selection ? `${selection.top}–${selection.bottom}` : "—"
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
          <fieldset :disabled="disabled">
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
              <label class="mr-binding-label">{{ m.dataset
                }}<select
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
              <label v-if="dataset" class="mr-binding-label">{{ m.rowKey
                }}<select v-model="recipe.rowKey" :aria-label="m.rowKey">
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
                  ><span>{{ item.physical }}</span>
                  <div>
                    <select
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
            <section class="mr-binding-group">
              <h3><b>3</b>{{ m.identity }}</h3>
              <label class="mr-binding-label">{{ m.templateId
                }}<input :value="lockId ? props.identity?.id ?? identity.id : identity.id" autocomplete="off" :readonly="lockId" @input="identity.id = ($event.target as HTMLInputElement).value" /></label><label class="mr-binding-label">{{ m.templateName
                }}<input v-model="identity.name" autocomplete="off" /></label>
            </section>
          </fieldset>
        </div>
      </div>
      <div
        v-if="checked && validation.issues.length"
        class="mr-binding-issues"
        role="alert"
      >
        <strong>{{ m.issues }} · {{ validation.issues.length }}
          {{ m.errors }}</strong>
        <ul>
          <li
            v-for="(issue, index) in validation.issues.slice(0, 12)"
            :key="index"
          >
            <code>{{ issue.path }}</code>{{ issue.message }}
          </li>
        </ul>
        <span v-if="validation.issues.length > 12">+ {{ validation.issues.length - 12 }}</span>
      </div>
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
        <span :class="{ 'is-ready': validation.ok }" role="status">{{
          readonly
            ? m.readonly
            : applied
              ? m.applied
              : validation.ok
                ? m.ready
                : `${m.coverage} ${validation.mapped}/${validation.total}`
        }}</span><button type="button" :disabled="disabled" @click="wizard.check">
          {{ m.check }}
</button><button
          type="button"
          class="mr-binding-primary"
          :disabled="disabled || !validation.ok"
          @click="wizard.apply"
        >
          {{ m.apply }}
        </button>
      </footer>
    </template>
  </section>
</template>

<style scoped src="./excel-binding.css"></style>
