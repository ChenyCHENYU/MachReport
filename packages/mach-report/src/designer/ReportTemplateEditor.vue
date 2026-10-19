<script setup lang="ts">
import { ReportPreview } from "@agile-team/mach-report/vue";
import type { ReportTemplateDocument } from "@agile-team/mach-report";
import { computed, getCurrentInstance, nextTick, ref, watch } from "vue";
import ReportIcon from "../vue/ReportIcon.vue";
import {
  useTemplateEditor,
  type TemplateEditorOptions,
} from "./useTemplateEditor";
import {
  useTemplateInspector,
  type TemplateInspectorSection,
} from "./useTemplateInspector";

const props = defineProps<TemplateEditorOptions>();
const emit = defineEmits<{
  (event: "update:modelValue", document: ReportTemplateDocument): void;
  (event: "saved", document: ReportTemplateDocument): void;
}>();
const editor = useTemplateEditor(props, (event, document) => {
  if (event === "saved") emit("saved", document);
  else emit("update:modelValue", document);
});
const {
  draft,
  json,
  selected,
  error,
  saving,
  pendingLocalChanges,
  jsonPending,
  blocked,
  confirmation,
  canUndo,
  canRedo,
  validation,
  lists,
  activeList,
  visibleColumns,
  query,
  selectedColumns,
  fetcher,
  messages: m,
} = editor;
const inspector = useTemplateInspector(
  visibleColumns,
  selected,
  activeList,
  query,
);
const { section, activeIndex, activeColumn } = inspector;
const id = `mr-designer-${getCurrentInstance()?.uid ?? 0}`;
const sections: TemplateInspectorSection[] = ["fields", "template", "advanced"];
const headingStatus = computed(() =>
  saving.value
    ? m.value.saving
    : props.readonly
      ? m.value.readonly
      : pendingLocalChanges.value
        ? m.value.dirty
        : m.value.ready,
);
const keepButton = ref<HTMLButtonElement | null>(null);
const columnList = ref<HTMLDivElement | null>(null);
const inspectorPanel = ref<HTMLDivElement | null>(null);
watch(section, async (value) => {
  await nextTick();
  if (inspectorPanel.value) inspectorPanel.value.scrollTop = 0;
  if (value !== "fields") return;
  const list = columnList.value;
  const button = list?.querySelector<HTMLButtonElement>(
    `button[data-column-index="${activeIndex.value}"]`,
  );
  if (!list || !button) return;
  // 仅移动字段目录自身，不抢分区按钮焦点，也不滚动外层页面。
  const bounds = list.getBoundingClientRect(), target = button.getBoundingClientRect();
  const top = bounds.top + list.clientTop, bottom = top + list.clientHeight;
  if (target.top < top) list.scrollTop += target.top - top;
  else if (target.bottom > bottom) list.scrollTop += target.bottom - bottom;
});
let previousFocus: HTMLElement | null = null;
watch(confirmation, async (value) => {
  if (value) {
    previousFocus = document.activeElement as HTMLElement | null;
    await nextTick();
    keepButton.value?.focus();
  } else {
    await nextTick();
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  }
});
defineExpose({
  get pendingLocalChanges() {
    return pendingLocalChanges.value;
  },
  get saving() {
    return saving.value;
  },
  get blocked() {
    return blocked.value;
  },
  guardChanges: editor.guardChanges,
  reset: editor.reset,
  save: editor.save,
});
function value(event: Event): string {
  return (event.target as HTMLInputElement).value;
}
function checked(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}
function batch(event: Event, target: "align" | "headerAlign"): void {
  const select = event.target as HTMLSelectElement;
  editor.alignColumns(
    target,
    select.value as "left" | "center" | "right" | "justify" | "auto",
  );
  select.value = "";
}
async function navigateColumn(event: KeyboardEvent): Promise<void> {
  const index = inspector.moveColumn(event.key);
  if (index === undefined) return;
  event.preventDefault();
  const list = (event.currentTarget as HTMLElement).closest(
    ".mr-designer-column-list",
  );
  await nextTick();
  const button = list?.querySelector<HTMLButtonElement>(
    `button[data-column-index="${index}"]`,
  );
  button?.focus({ preventScroll: true });
  button?.scrollIntoView({ block: "nearest" });
}
async function navigateSection(event: KeyboardEvent): Promise<void> {
  const keys: Record<string, number> = {
    ArrowRight: 1,
    ArrowLeft: -1,
    Home: -sections.length,
    End: sections.length,
  };
  const delta = keys[event.key];
  if (delta === undefined) return;
  event.preventDefault();
  const current = sections.indexOf(section.value);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? sections.length - 1
        : (current + delta + sections.length) % sections.length;
  section.value = sections[next]!;
  const tabs = (event.currentTarget as HTMLElement).parentElement;
  await nextTick();
  tabs
    ?.querySelector<HTMLButtonElement>(`#${id}-tab-${section.value}`)
    ?.focus();
}
</script>

<template>
  <section class="mr-designer" :aria-label="m.title" :aria-busy="saving">
    <header class="mr-designer-bar">
      <div class="mr-designer-heading">
        <ReportIcon name="columns" :size="18" />
        <div>
          <strong>{{ m.heading }}</strong><span :class="{ 'mr-designer-dirty': pendingLocalChanges }">{{
            headingStatus
          }}</span>
        </div>
      </div>
      <div class="mr-designer-actions">
        <div class="mr-designer-history">
          <button
            type="button"
            class="mr-designer-icon-button"
            :aria-label="m.undo"
            :title="m.undo"
            :disabled="readonly || blocked || !canUndo"
            @click="editor.undo"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 10h10a6 6 0 0 1 0 12M4 10l5-5M4 10l5 5" />
            </svg>
          </button>
          <button
            type="button"
            class="mr-designer-icon-button"
            :aria-label="m.redo"
            :title="m.redo"
            :disabled="readonly || blocked || !canRedo"
            @click="editor.redo"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M20 10H10a6 6 0 0 0 0 12m10-12-5-5m5 5-5 5" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          class="mr-designer-reset"
          :disabled="readonly || blocked || !pendingLocalChanges"
          @click="editor.reset"
        >
          {{ m.reset }}
        </button>
        <button
          v-if="save"
          type="button"
          class="mr-designer-save"
          :disabled="
            readonly ||
            blocked ||
            jsonPending ||
            !validation.ok ||
            !pendingLocalChanges
          "
          @click="editor.save"
        >
          <ReportIcon name="file" :size="14" />{{ saving ? m.saving : m.save }}
        </button>
      </div>
    </header>
    <div
      v-if="confirmation"
      role="alertdialog"
      :aria-label="m.discardTitle"
      class="mr-designer-confirm"
      @keydown.esc.prevent="editor.decideDiscard(false)"
    >
      <div>
        <strong>{{ m.discardTitle }}</strong>
        <p>{{ m.discardDescription }}</p>
      </div>
      <div>
        <button
          ref="keepButton"
          type="button"
          @click="editor.decideDiscard(false)"
        >
          {{ m.keepEditing }}
</button><button type="button" @click="editor.decideDiscard(true)">
          {{ m.discard }}
        </button>
      </div>
    </div>
    <div class="mr-designer-body">
      <aside class="mr-designer-inspector">
        <nav
          class="mr-designer-tabs"
          role="tablist"
          :aria-label="m.sectionsLabel"
        >
          <button
            v-for="item in sections"
            :id="`${id}-tab-${item}`"
            :key="item"
            type="button"
            role="tab"
            :aria-selected="section === item"
            :aria-controls="`${id}-panel-${item}`"
            :tabindex="section === item ? 0 : -1"
            @click="section = item"
            @keydown="navigateSection"
          >
            {{ m[`${item}Section`] }}
          </button>
        </nav>
        <div
          ref="inspectorPanel"
          :id="`${id}-panel-${section}`"
          class="mr-designer-panel"
          role="tabpanel"
          :aria-labelledby="`${id}-tab-${section}`"
        >
          <template v-if="section === 'fields'">
            <label v-if="lists.length > 1" class="mr-designer-area">{{ m.area
              }}<select v-model="selected">
                <option
                  v-for="(item, index) in lists"
                  :key="index"
                  :value="index"
                >
                  {{ item.pageIndex + 1 }} {{ m.page }} ·
                  {{ item.component.title || item.component.dataset }}
                </option>
              </select></label>
            <div v-if="activeList" class="mr-designer-columns">
              <div class="mr-designer-directory-heading">
                <strong>{{ m.columnDirectory }}</strong><span>{{ activeList.columns.length }} {{ m.fieldsCount }}</span>
              </div>
              <div class="mr-designer-search">
                <ReportIcon name="search" :size="15" /><input
                  v-model="query"
                  type="search"
                  :aria-label="m.columnsSearch"
                  :placeholder="m.columnsSearch"
                /><button
                  v-if="query"
                  type="button"
                  class="mr-designer-icon-button"
                  :aria-label="m.clearSearch"
                  :title="m.clearSearch"
                  @click="query = ''"
                >
                  <ReportIcon name="close" :size="14" />
                </button>
              </div>
              <div class="mr-designer-column-tools">
                <button
                  type="button"
                  :disabled="
                    readonly || blocked || jsonPending || !visibleColumns.length
                  "
                  @click="editor.selectVisible(true)"
                >
                  {{ m.selectVisible }}
</button><button
                  v-if="selectedColumns.length"
                  type="button"
                  @click="editor.clearSelection"
                >
                  {{ m.clearSelection }}
</button><span v-if="selectedColumns.length" role="status">{{ m.columnsSelected }} {{ selectedColumns.length }}</span><span v-else>{{ visibleColumns.length }} /
                  {{ activeList.columns.length }}</span>
              </div>
              <div
                ref="columnList"
                class="mr-designer-column-list"
                :aria-label="m.columnDirectory"
                role="group"
              >
                <div
                  v-for="{ column, index } in visibleColumns"
                  :key="index"
                  class="mr-designer-column-row"
                  :class="{ 'is-active': activeIndex === index }"
                >
                  <input
                    type="checkbox"
                    :aria-label="`${m.selectColumn} ${column.header}`"
                    :checked="selectedColumns.includes(index)"
                    :disabled="readonly || blocked || jsonPending"
                    @change="editor.toggleColumn(index, checked($event))"
                  />
                  <button
                    type="button"
                    :data-column-index="index"
                    :aria-pressed="activeIndex === index"
                    :tabindex="activeIndex === index ? 0 : -1"
                    @click="inspector.activate(index)"
                    @keydown="navigateColumn"
                  >
                    <span class="mr-designer-column-number">{{
                      index + 1
                    }}</span><span class="mr-designer-column-name"><strong>{{ column.header }}</strong><small>{{ column.field }}</small></span><ReportIcon
                      v-if="activeIndex === index"
                      name="chevron-right"
                      :size="14"
                    />
                  </button>
                </div>
                <p
                  v-if="!visibleColumns.length"
                  role="status"
                  class="mr-designer-empty"
                >
                  <ReportIcon name="search" :size="20" />{{ m.noColumns }}
                </p>
              </div>
              <div v-if="selectedColumns.length" class="mr-designer-batch">
                <label>{{ m.batchBody
                  }}<select
                    :aria-label="m.batchBody"
                    :disabled="readonly || blocked || jsonPending"
                    @change="batch($event, 'align')"
                  >
                    <option value="">{{ m.chooseAlignment }}</option>
                    <option value="auto">{{ m.auto }}</option>
                    <option value="left">{{ m.left }}</option>
                    <option value="center">{{ m.center }}</option>
                    <option value="right">{{ m.right }}</option>
                    <option value="justify">{{ m.justify }}</option>
                  </select></label>
                <label>{{ m.batchHeader
                  }}<select
                    :aria-label="m.batchHeader"
                    :disabled="readonly || blocked || jsonPending"
                    @change="batch($event, 'headerAlign')"
                  >
                    <option value="">{{ m.chooseAlignment }}</option>
                    <option value="left">{{ m.left }}</option>
                    <option value="center">{{ m.center }}</option>
                    <option value="right">{{ m.right }}</option>
                    <option value="justify">{{ m.justify }}</option>
                  </select></label>
              </div>
              <fieldset
                v-if="activeColumn"
                class="mr-designer-properties"
                :disabled="readonly || blocked || jsonPending"
              >
                <legend>
                  {{ m.columnProperties }}
                  <span>{{ activeColumn.index + 1 }} ·
                    {{ activeColumn.column.header }}</span>
                </legend>
                <label>{{ m.header
                  }}<input
                    :value="activeColumn.column.header"
                    @input="
                      editor.setColumn(
                        activeColumn.index,
                        'header',
                        value($event),
                      )
                    "
                /></label>
                <label>{{ m.field
                  }}<input
                    :value="activeColumn.column.field"
                    @change="
                      editor.setColumn(
                        activeColumn.index,
                        'field',
                        value($event),
                      )
                    "
                /></label>
                <label>{{ m.width
                  }}<input
                    type="number"
                    min="0.1"
                    step="0.5"
                    :value="activeColumn.column.widthMm"
                    @change="
                      editor.setColumn(
                        activeColumn.index,
                        'widthMm',
                        value($event),
                      )
                    "
                /></label>
                <label>{{ m.semantic
                  }}<select
                    :value="activeColumn.column.semanticRole || 'text'"
                    @change="
                      editor.setColumn(
                        activeColumn.index,
                        'semanticRole',
                        value($event),
                      )
                    "
                  >
                    <option value="identifier">{{ m.identifier }}</option>
                    <option value="dimension">{{ m.dimension }}</option>
                    <option value="measure">{{ m.measure }}</option>
                    <option value="date">{{ m.date }}</option>
                    <option value="text">{{ m.text }}</option>
                  </select></label>
                <label>{{ m.bodyAlign
                  }}<select
                    :value="
                      activeColumn.column.align ??
                      activeColumn.column.style?.align ??
                      activeList.align ??
                      'left'
                    "
                    @change="
                      editor.setColumn(
                        activeColumn.index,
                        'align',
                        value($event),
                      )
                    "
                  >
                    <option value="auto">{{ m.auto }}</option>
                    <option value="left">{{ m.left }}</option>
                    <option value="center">{{ m.center }}</option>
                    <option value="right">{{ m.right }}</option>
                    <option value="justify">{{ m.justify }}</option>
                  </select></label>
                <label>{{ m.headerAlign
                  }}<select
                    :value="editor.headerAlignments.value[activeColumn.index]"
                    @change="
                      editor.setColumn(
                        activeColumn.index,
                        'headerAlign',
                        value($event),
                      )
                    "
                  >
                    <option value="left">{{ m.left }}</option>
                    <option value="center">{{ m.center }}</option>
                    <option value="right">{{ m.right }}</option>
                    <option value="justify">{{ m.justify }}</option>
                  </select></label>
                <label class="mr-designer-toggle">{{ m.editable
                  }}<input
                    type="checkbox"
                    :checked="activeColumn.column.editable === true"
                    @change="
                      editor.setColumn(
                        activeColumn.index,
                        'editable',
                        checked($event),
                      )
                    "
                /></label>
              </fieldset>
            </div>
            <p v-else role="status" class="mr-designer-empty">
              {{ m.noColumns }}
            </p>
          </template>
          <template v-else-if="section === 'template'">
            <h3>{{ m.templateDetails }}</h3>
            <label class="mr-designer-stacked">{{ m.name
              }}<input
                :value="draft.name"
                :disabled="readonly || blocked || jsonPending"
                @input="editor.setName(value($event))"
            /></label>
            <label class="mr-designer-stacked">{{ m.description
              }}<textarea
                rows="4"
                :value="draft.description"
                :disabled="readonly || blocked || jsonPending"
                @input="editor.setDescription(value($event))"
              />
            </label>
            <dl class="mr-designer-identity">
              <dt>{{ m.templateIdentity }}</dt>
              <dd>{{ draft.id }}</dd>
              <dt>{{ m.templateRevision }}</dt>
              <dd>{{ draft.revision || m.unpublished }}</dd>
            </dl>
            <p class="mr-designer-note">{{ m.note }}</p>
          </template>
          <template v-else>
            <h3>{{ m.advancedTitle }}</h3>
            <p class="mr-designer-note">{{ m.advancedDescription }}</p>
            <label class="mr-designer-stacked">{{ m.json
              }}<textarea
                v-model="json"
                class="mr-designer-json"
                :aria-label="m.json"
                :disabled="readonly || blocked"
                spellcheck="false"
              />
            </label>
            <button
              type="button"
              class="mr-designer-apply-json"
              :disabled="readonly || blocked"
              @click="editor.applyJson"
            >
              {{ m.applyJson }}
            </button>
          </template>
          <p
            v-if="jsonPending"
            role="status"
            class="mr-designer-note mr-designer-pending"
          >
            {{ m.jsonPending }}
          </p>
        </div>
      </aside>
      <div class="mr-designer-preview" :aria-label="m.previewTitle">
        <div v-if="error" role="alert" class="mr-designer-error">
          {{ error }}
        </div>
        <ul v-if="!validation.ok" role="alert" class="mr-designer-error">
          <li v-for="issue in validation.errors" :key="issue.path">
            {{ issue.path }}：{{ issue.message }}
          </li>
        </ul>
        <ReportPreview
          v-if="fetcher && validation.ok"
          report-id="draft"
          :fetcher="fetcher"
          :show-params="false"
          :editable="false"
          :excel-import="false"
          height="100%"
        />
        <p v-else class="mr-designer-note mr-designer-invalid">
          {{ m.invalid }}
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped src="./template-editor.css"></style>
