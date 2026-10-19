<script setup lang="ts">
import { ReportPreview } from "@agile-team/mach-report/vue";
import { parseReportTemplate, type ReportTemplateDocument } from "@agile-team/mach-report";
import {
  computed,
  defineAsyncComponent,
  getCurrentInstance,
  nextTick,
  ref,
  watch,
} from "vue";
import type { ExcelBindingWizardApply } from "./useExcelBindingWizard";
import ReportIcon from "../vue/ReportIcon.vue";
import TemplateDesignCanvas from "./TemplateDesignCanvas.vue";
import CanvasComponentInspector from "./CanvasComponentInspector.vue";
import HeaderStructureEditor from "./HeaderStructureEditor.vue";
import { useTemplateWorkspace } from "./useTemplateWorkspace";
import AlignmentControl from "./AlignmentControl.vue";
import { useTemplateDirectory } from "./useTemplateDirectory";
import {
  useTemplateEditor,
  type TemplateEditorOptions,
} from "./useTemplateEditor";
import {
  useTemplateInspector,
  type TemplateInspectorSection,
} from "./useTemplateInspector";

const ExcelBindingWizard = defineAsyncComponent(
  () => import("./ExcelBindingWizard.vue"),
);
const RuleEditor = defineAsyncComponent(() => import("./RuleEditor.vue"));
const TemplateReviewPanel = defineAsyncComponent(
  () => import("./TemplateReviewPanel.vue"),
);
const props = defineProps<TemplateEditorOptions>();
const emit = defineEmits<{
  (event: "update:modelValue", document: ReportTemplateDocument): void;
  (event: "saved", document: ReportTemplateDocument): void;
  (event: "excel-bound", result: ExcelBindingWizardApply): void;
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
const inspector = useTemplateInspector(selected, activeList);
const { section, activeIndex, activeColumn } = inspector;
const id = `mr-designer-${getCurrentInstance()?.uid ?? 0}`;
const sections: TemplateInspectorSection[] = [
  "fields",
  "component",
  "template",
  "tools",
  "advanced",
];
const workspace = useTemplateWorkspace(
  editor,
  inspector,
  () => props.dataSchemas,
);
const {
  mode,
  setMode,
  canvasSelection,
  canvasPage,
  canvasActive,
  tool,
  visitedTools,
  editDisabled,
  dataSchema,
  chooseCanvas,
  insertComponent,
  patchCanvas,
  changeList,
  moveColumn,
  headerCommand,
  locateReview,
  canvas,
} = workspace;

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
const inspectorPanel = ref<HTMLDivElement | null>(null);
const directory = useTemplateDirectory(inspector, section, visibleColumns);
const {
  open: directoryOpen,
  cursor: directoryCursor,
  trigger: directoryTrigger,
  panel: directoryPanel,
  search: directorySearch,
  list: columnList,
} = directory;
watch(section, async () => {
  await nextTick();
  if (inspectorPanel.value) inspectorPanel.value.scrollTop = 0;
});
const alignLabels = computed(() => ({
  auto: m.value.auto,
  left: m.value.left,
  center: m.value.center,
  right: m.value.right,
  justify: m.value.justify,
}));
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
async function acceptExcel(result: ExcelBindingWizardApply): Promise<void> {
  // Binding inside an editor replaces content, never the persistent template identity or CAS revision.
  const candidate = { ...result.document, id: draft.value.id };
  if (draft.value.revision === undefined) delete candidate.revision;
  else candidate.revision = draft.value.revision;
  if (!await editor.replaceDocument(candidate)) return;
  const document = parseReportTemplate(editor.draft.value);
  emit("excel-bound", { ...result, document, session: { ...result.session, identity: { id: document.id, name: document.name } } });
}
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
        <ReportIcon name="columns" :size="15" />
        <strong>{{ m.heading }}</strong>
        <span :class="{ 'mr-designer-dirty': pendingLocalChanges }">{{
          headingStatus
        }}</span>
      </div>
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
      <div class="mr-designer-mode" role="group" :aria-label="m.design">
        <button
          type="button"
          :aria-pressed="mode === 'design'"
          @click="setMode('design')"
        >
          {{ m.design }}
</button><button
          type="button"
          :aria-pressed="mode === 'preview'"
          @click="setMode('preview')"
        >
          {{ m.preview }}
        </button>
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
          <ReportIcon name="file" :size="13" />{{ saving ? m.saving : m.save }}
        </button>
      </div>
    </header>
    <div
      v-if="confirmation"
      role="alertdialog"
      :aria-label="m.discardTitle"
      class="mr-designer-confirm"
      @keydown.esc.prevent.stop="editor.decideDiscard(false)"
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
    <div class="mr-designer-body" :class="{ 'is-tools': section === 'tools' }">
      <div
        v-if="visitedTools.size"
        v-show="section === 'tools'"
        class="mr-designer-tools"
      >
        <nav class="mr-designer-tool-tabs" :aria-label="m.toolsSection">
          <button
            v-for="item in ['excel', 'rules', 'review'] as const"
            :key="item"
            type="button"
            :aria-pressed="tool === item"
            @click="tool = item"
          >
            {{ m[`${item}Tool`] }}
</button><span>{{ m.toolsDescription }}</span>
        </nav>
        <div class="mr-designer-tool-content">
          <ExcelBindingWizard
            v-if="visitedTools.has('excel')"
            v-show="tool === 'excel'"
            :datasets="bindingDatasets ?? []"
            :session="bindingSession"
            :identity="{ id: draft.id, name: draft.name }"
            lock-id
            :readonly="editDisabled"
            @apply="acceptExcel"
          /><TemplateReviewPanel
            v-if="visitedTools.has('review')"
            v-show="tool === 'review'"
            :document="draft"
            :previous="editor.originalDocument.value"
            :datasets="datasets"
            :data-schemas="dataSchemas"
            @locate="locateReview"
          />
          <div
            v-if="visitedTools.has('rules')"
            v-show="tool === 'rules'"
            class="mr-designer-rule-workspace"
          >
            <label v-if="lists.length > 1">{{ m.area
              }}<select v-model="selected">
                <option
                  v-for="(item, index) in lists"
                  :key="index"
                  :value="index"
                >
                  {{ item.component.title || item.component.dataset }}
                </option>
              </select></label><RuleEditor
              v-if="activeList"
              :list="activeList"
              :datasets="datasets"
              :dataset-schema="dataSchema"
              :dataset-schemas="dataSchemas"
              :readonly="editDisabled"
              @change="changeList"
            />
            <p v-else class="mr-designer-note">{{ m.rulesNeedList }}</p>
          </div>
        </div>
      </div>
      <aside v-if="section !== 'tools'" class="mr-designer-inspector">
        <div
          ref="inspectorPanel"
          :id="`${id}-panel-${section}`"
          class="mr-designer-panel"
          :class="{ 'is-advanced': section === 'advanced' }"
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
            <template v-if="activeList">
              <div class="mr-designer-current">
                <button
                  ref="directoryTrigger"
                  type="button"
                  class="mr-designer-field-trigger"
                  :aria-expanded="directoryOpen"
                  :aria-controls="`${id}-directory`"
                  aria-haspopup="dialog"
                  @click="directory.toggle"
                  @keydown.esc="directory.escape"
                >
                  <span class="mr-designer-current-name"><strong>{{
                      activeColumn?.column.header || m.noColumns
                    }}</strong><small>{{
                      activeColumn?.column.field || "—"
                    }}</small></span><span class="mr-designer-directory-entry">{{ m.columnDirectory }}
                    <b>{{ activeList.columns.length }}</b><ReportIcon name="chevron-down" :size="13" /></span>
                </button>
                <div class="mr-designer-field-position">
                  <span :aria-label="m.fieldPosition">{{ activeIndex >= 0 ? activeIndex + 1 : 0 }}<i>/</i>{{ activeList.columns.length }}</span>
                  <button
                    type="button"
                    class="mr-designer-icon-button"
                    :aria-label="m.previousColumn"
                    :title="m.previousColumn"
                    :disabled="activeIndex <= 0"
                    @click="inspector.stepColumn(-1)"
                  >
                    <ReportIcon name="chevron-left" :size="14" />
                  </button>
                  <button
                    type="button"
                    class="mr-designer-icon-button"
                    :aria-label="m.nextColumn"
                    :title="m.nextColumn"
                    :disabled="activeIndex >= activeList.columns.length - 1"
                    @click="inspector.stepColumn(1)"
                  >
                    <ReportIcon name="chevron-right" :size="14" />
                  </button>
                </div>
              </div>
              <fieldset
                v-if="activeColumn"
                class="mr-designer-properties"
                :disabled="readonly || blocked || jsonPending"
                :aria-label="m.columnProperties"
              >
                <div class="mr-designer-property-group">
                  <h3>{{ m.contentGroup }}</h3>
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
                      :list="dataSchema ? `${id}-fields` : undefined"
                      @change="
                        editor.setColumn(
                          activeColumn.index,
                          'field',
                          value($event),
                        )
                      "
/></label><datalist v-if="dataSchema" :id="`${id}-fields`">
                    <option
                      v-for="field in dataSchema.fields"
                      :key="field.field"
                      :value="field.field"
                    >
                      {{ field.label }} · {{ field.type }} {{ field.unit }}
                    </option>
                  </datalist>
                </div>
                <div class="mr-designer-property-group">
                  <h3>{{ m.formatGroup }}</h3>
                  <div class="mr-designer-format-pair">
                    <label class="mr-designer-stacked">{{ m.width
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
                    <label class="mr-designer-stacked">{{ m.semantic
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
                  </div>
                  <div class="mr-designer-control-row">
                    <span>{{ m.bodyAlign }}</span><AlignmentControl
                      :model-value="
                        activeColumn.column.align ??
                        activeColumn.column.style?.align ??
                        activeList.align ??
                        'left'
                      "
                      :label="m.bodyAlign"
                      :labels="alignLabels"
                      :auto-label="m.autoShort"
                      allow-auto
                      @update:model-value="
                        editor.setColumn(activeColumn.index, 'align', $event)
                      "
                    />
                  </div>
                  <div class="mr-designer-control-row">
                    <span>{{ m.headerAlign }}</span><AlignmentControl
                      :model-value="
                        editor.headerAlignments.value[activeColumn.index] ||
                        'left'
                      "
                      :label="m.headerAlign"
                      :labels="alignLabels"
                      :auto-label="m.autoShort"
                      @update:model-value="
                        editor.setColumn(
                          activeColumn.index,
                          'headerAlign',
                          $event,
                        )
                      "
                    />
                  </div>
                </div>
                <label class="mr-designer-toggle">{{ m.editable
                  }}<input
                    type="checkbox"
                    role="switch"
                    :checked="activeColumn.column.editable === true"
                    @change="
                      editor.setColumn(
                        activeColumn.index,
                        'editable',
                        checked($event),
                      )
                    "
                /></label>
                <div class="mr-designer-column-structure">
                  <span>{{ m.columnOrder }}</span><button
                    type="button"
                    :aria-label="m.moveColumnLeft"
                    :title="m.moveColumnLeft"
                    :disabled="activeIndex <= 0"
                    @click="moveColumn(-1)"
                  >
                    <ReportIcon name="chevron-left" :size="13" />
</button><button
                    type="button"
                    :aria-label="m.moveColumnRight"
                    :title="m.moveColumnRight"
                    :disabled="activeIndex >= activeList.columns.length - 1"
                    @click="moveColumn(1)"
                  >
                    <ReportIcon name="chevron-right" :size="13" />
</button><label>{{ m.columnVisible
                    }}<input
                      type="checkbox"
                      :checked="activeColumn.column.hidden !== true"
                      :disabled="
                        activeColumn.column.hidden !== true &&
                        activeList.columns.filter((column) => !column.hidden)
                          .length === 1
                      "
                      @change="
                        editor.setColumn(
                          activeColumn.index,
                          'hidden',
                          !checked($event),
                        )
                      "
                  /></label>
                </div>
              </fieldset>
              <div
                v-if="directoryOpen"
                :id="`${id}-directory`"
                ref="directoryPanel"
                role="dialog"
                :aria-label="m.columnDirectory"
                class="mr-designer-directory"
                @keydown.esc="directory.escape"
                @focusout="directory.leave"
              >
                <div class="mr-designer-directory-heading">
                  <strong>{{ m.columnDirectory }}
                    <span>{{ activeList.columns.length }}</span></strong><button
                    type="button"
                    class="mr-designer-icon-button"
                    :aria-label="m.closeDirectory"
                    @click="directory.close(true)"
                  >
                    <ReportIcon name="close" :size="15" />
                  </button>
                </div>
                <div class="mr-designer-search">
                  <ReportIcon name="search" :size="14" /><input
                    ref="directorySearch"
                    v-model="query"
                    type="search"
                    :aria-label="m.columnsSearch"
                    :placeholder="m.columnsSearch"
                    @keydown="directory.searchKeydown"
                  /><button
                    v-if="query"
                    type="button"
                    class="mr-designer-icon-button"
                    :aria-label="m.clearSearch"
                    :title="m.clearSearch"
                    @click="query = ''"
                  >
                    <ReportIcon name="close" :size="13" />
                  </button>
                </div>
                <div class="mr-designer-column-tools">
                  <button
                    type="button"
                    :disabled="
                      readonly ||
                      blocked ||
                      jsonPending ||
                      !visibleColumns.length
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
                    /><button
                      type="button"
                      :data-column-index="index"
                      :aria-pressed="activeIndex === index"
                      :tabindex="directoryCursor === index ? 0 : -1"
                      @click="directory.choose(index)"
                      @keydown="directory.navigate"
                    >
                      <span class="mr-designer-column-number">{{
                        index + 1
                      }}</span><span class="mr-designer-column-name"><strong>{{ column.header }}</strong><small>{{ column.field }}</small></span><ReportIcon
                        v-if="activeIndex === index"
                        name="chevron-right"
                        :size="13"
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
                    </select></label><label>{{ m.batchHeader
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
              </div>
            </template>
            <p v-else role="status" class="mr-designer-empty">
              {{ m.noColumns }}
            </p>
          </template>
          <template v-else-if="section === 'component'">
            <div class="mr-designer-object-tools">
              <select
                :aria-label="m.insertComponent"
                :disabled="editDisabled"
                @change="insertComponent"
              >
                <option value="">{{ m.insertComponent }}</option>
                <option value="text">{{ m.insertText }}</option>
                <option value="list">{{ m.insertList }}</option>
                <option value="image">{{ m.insertImage }}</option>
                <option value="rect">{{ m.insertRect }}</option>
</select><button
                type="button"
                :title="m.duplicateComponent"
                :aria-label="m.duplicateComponent"
                :disabled="editDisabled || !canvasActive"
                @click="canvas.duplicate"
              >
                ＋
</button><button
                type="button"
                :title="m.removeComponent"
                :aria-label="m.removeComponent"
                :disabled="editDisabled || !canvasActive"
                @click="canvas.remove"
              >
                <ReportIcon name="close" :size="14" />
              </button>
            </div>
            <label v-if="draft.template.pages.length > 1">{{ m.page
              }}<select v-model.number="canvasPage">
                <option
                  v-for="(_, pageIndex) in draft.template.pages"
                  :key="pageIndex"
                  :value="pageIndex"
                >
                  {{ pageIndex + 1 }}
                </option>
              </select></label>
            <label class="mr-designer-stacked">{{ m.components
              }}<select
                :value="
                  canvasSelection?.pageIndex === canvasPage
                    ? canvasSelection.componentIndex
                    : -1
                "
                @change="
                  chooseCanvas({
                    pageIndex: canvasPage,
                    componentIndex: Number(value($event)),
                  })
                "
              >
                <option :value="-1" disabled>{{ m.noComponent }}</option>
                <option
                  v-for="(component, componentIndex) in draft.template.pages[
                    canvasPage
                  ]?.components"
                  :key="componentIndex"
                  :value="componentIndex"
                >
                  {{ componentIndex + 1 }} ·
                  {{
                    component.kind === "list"
                      ? component.title || component.dataset
                      : component.text || component.kind
                  }}
                </option>
              </select></label>
            <template v-if="canvasActive">
              <div class="mr-designer-layer-tools">
                <button
                  type="button"
                  :disabled="
                    editDisabled || canvasSelection?.componentIndex === 0
                  "
                  @click="canvas.reorder(-1)"
                >
                  {{ m.backward }}
</button><button
                  type="button"
                  :disabled="
                    editDisabled ||
                    canvasSelection?.componentIndex ===
                      (draft.template.pages[canvasPage]?.components.length ??
                        0) -
                        1
                  "
                  @click="canvas.reorder(1)"
                >
                  {{ m.forward }}
                </button>
              </div>
              <CanvasComponentInspector
                :component="canvasActive"
                :disabled="editDisabled"
                :messages="m"
                @geometry="canvas.geometry"
                @patch="patchCanvas"
              /><HeaderStructureEditor
                v-if="canvasActive.kind === 'list'"
                :list="canvasActive"
                :disabled="editDisabled"
                :messages="m"
                @command="headerCommand"
              />
            </template>
            <p v-else class="mr-designer-empty">{{ m.noComponent }}</p>
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
                rows="2"
                :value="draft.description"
                :disabled="readonly || blocked || jsonPending"
                @input="editor.setDescription(value($event))"
              />
            </label>
            <details class="mr-designer-technical">
              <summary>{{ m.technicalDetails }}</summary>
              <dl class="mr-designer-identity">
                <dt>{{ m.templateIdentity }}</dt>
                <dd>{{ draft.id }}</dd>
                <dt>{{ m.templateRevision }}</dt>
                <dd>{{ draft.revision || m.unpublished }}</dd>
              </dl>
            </details>
          </template>
          <template v-else>
            <h3>{{ m.advancedTitle }}</h3>
            <label class="mr-designer-stacked mr-designer-json-label">{{ m.json
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
      <div
        v-if="section !== 'tools'"
        class="mr-designer-preview"
        :aria-label="m.previewTitle"
      >
        <div v-if="error" role="alert" class="mr-designer-error">
          {{ error }}
        </div>
        <ul v-if="!validation.ok" role="alert" class="mr-designer-error">
          <li v-for="issue in validation.errors" :key="issue.path">
            {{ issue.path }}：{{ issue.message }}
          </li>
        </ul>
        <TemplateDesignCanvas
          v-if="mode === 'design' && validation.ok"
          :document="draft"
          :selection="canvasSelection"
          :page-index="canvasPage"
          :datasets="datasets"
          :disabled="editDisabled"
          :messages="m"
          @select="chooseCanvas"
          @geometry="canvas.geometry"
          @column="inspector.activate"
          @width="
            (index, width) => editor.setColumn(index, 'widthMm', String(width))
          "
        />
        <ReportPreview
          v-else-if="fetcher && validation.ok"
          report-id="draft"
          :fetcher="fetcher"
          :messages="{
            title: m.previewTitle,
            columnDirectory: m.previewFieldDirectory,
          }"
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
