<script setup lang="ts">
import { ReportPreview } from "@agile-team/mach-report/vue";
import { parseReportTemplate, type ReportTemplateDocument, type ReportParamDef } from "@agile-team/mach-report";
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
import TemplatePageInspector from "./TemplatePageInspector.vue";
import TemplateRepeatInspector from "./TemplateRepeatInspector.vue";
import TemplateFieldImpactPanel from "./TemplateFieldImpactPanel.vue";
import TemplateRecoveryPanel from "./TemplateRecoveryPanel.vue";
import { applyPageCommand, pageName, type PageCommand } from "./page-commands";
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
const ParamEditor = defineAsyncComponent(() => import("./ParamEditor.vue"));
const RuleEditor = defineAsyncComponent(() => import("./RuleEditor.vue"));
const TemplateOutlinePanel = defineAsyncComponent(() => import("./TemplateOutlinePanel.vue"));
const TemplateReusePanel = defineAsyncComponent(() => import("./TemplateReusePanel.vue"));
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
function acceptParams(definitions: ReportParamDef[]): boolean {
  return editor.transaction(document => { document.template.params = definitions; });
}
const inspector = useTemplateInspector(selected, activeList);
const { section, activeIndex, activeColumn } = inspector;
const id = `mr-designer-${getCurrentInstance()?.uid ?? 0}`;
const sections = computed<TemplateInspectorSection[]>(() => [
  ...(lists.value.length ? ["fields" as const] : []),
  "component",
  "template",
  "tools",
  "advanced",
]);
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
  chooseCanvas: chooseCanvasUnchecked,
  insertComponent,
  patchCanvas,
  changeList,
  moveColumn,
  headerCommand,
  locateReview: locateReviewUnchecked,
  canvas,
} = workspace;

const canvasFlow = computed(() => !!draft.value.template.pages[canvasPage.value]?.flow);
const repeatSchema = computed(() => props.dataSchemas?.[draft.value.template.repeat?.dataset ?? ""]);
const componentDirectory = computed(() => {
  const names = { text: m.value.insertText, list: m.value.insertList, image: m.value.insertImage, rect: m.value.insertRect, qrcode: m.value.insertQrcode, barcode: m.value.insertBarcode, chart: m.value.chartComponent, line: m.value.lineComponent, ellipse: m.value.ellipseComponent };
  const fields = new Map(repeatSchema.value?.fields.map(field => [field.field, field.label || field.field]));
  return draft.value.template.pages[canvasPage.value]?.components.map((component, index) => {
    const type = names[component.kind];
    const content = component.kind === "list" ? component.title || component.dataset : component.binding ? fields.get(component.binding.field) || component.binding.field : component.text;
    const title = content?.replace(/\s+/g, " ").trim().slice(0, 60);
    return { index, name: title && title !== type ? `${type} · ${title}` : type };
  }) ?? [];
});
function pageCommand(command: PageCommand): void {
  let next = canvasPage.value;
  if (editor.transaction(document => { next = applyPageCommand(document, canvasPage.value, command); })) {
    if (command.type !== "patch") { canvas.clearLocks(); canvas.selection.value = undefined; canvas.selections.value = []; }
    canvasPage.value = next;
  }
}
const fieldFlow = computed(() => !!draft.value.template.pages[lists.value[selected.value]?.pageIndex ?? -1]?.flow);
function openBinding(): void { section.value = "tools"; tool.value = "excel"; }
type PendingTarget = "excel" | "rules" | "params" | "json";
const pendingConfigurations = computed(() => {
  const tools = (["excel", "rules", "params"] as const)
    .filter(item => editor.pendingTools.value.includes(item))
    .map(target => ({ target: target as PendingTarget, label: m.value[`${target}Tool`] }));
  if (jsonPending.value) tools.push({ target: "json", label: m.value.json });
  return tools;
});
const saveReason = computed(() => {
  if (saving.value) return m.value.saving;
  if (props.readonly) return m.value.saveReadonly;
  if (blocked.value) return m.value.saveConfirmation;
  if (pendingConfigurations.value.length) return pendingConfigurations.value.map(item => `${item.label} · ${m.value.unapplied}`).join("；");
  if (!validation.value.ok) return m.value.saveInvalid;
  return pendingLocalChanges.value ? "" : m.value.saveUnchanged;
});
async function openPending(target: PendingTarget): Promise<void> {
  if (target === "json") section.value = "advanced";
  else { section.value = "tools"; tool.value = target; }
  await nextTick();
  const selector = target === "json" ? `#${id}-panel-advanced textarea` : `#${id}-tool-${target}`;
  document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
}
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
async function acceptExcel(result: ExcelBindingWizardApply): Promise<boolean> {
  // Binding inside an editor replaces content, never the persistent template identity or CAS revision.
  const candidate = { ...result.document, id: draft.value.id };
  if (draft.value.revision === undefined) delete candidate.revision;
  else candidate.revision = draft.value.revision;
  if (!await editor.replaceDocument(candidate)) return false;
  const document = parseReportTemplate(editor.draft.value);
  emit("excel-bound", { ...result, document, session: { ...result.session, identity: { id: document.id, name: document.name } } });
  return true;
}
async function chooseCanvas(selection: Parameters<typeof chooseCanvasUnchecked>[0]): Promise<void> {
  const target = lists.value.findIndex(item => item.pageIndex === selection.pageIndex && item.componentIndex === selection.componentIndex);
  if (target >= 0 && target !== selected.value && editor.isToolPending("rules") && !await editor.guardChanges()) return;
  chooseCanvasUnchecked(selection);
}
async function locateReview(location: Parameters<typeof locateReviewUnchecked>[0]): Promise<void> {
  const path = /\.pages\[(\d+)\]\.components\[(\d+)\]/.exec(location.path ?? "");
  const pageIndex = location.pageIndex ?? (path ? Number(path[1]) : undefined), componentIndex = location.componentIndex ?? (path ? Number(path[2]) : undefined);
  const target = lists.value.findIndex(item => item.pageIndex === pageIndex && item.componentIndex === componentIndex);
  if (target >= 0 && target !== selected.value && editor.isToolPending("rules") && !await editor.guardChanges()) return;
  locateReviewUnchecked(location);
}
async function chooseRuleList(event: Event): Promise<void> {
  const target = event.target as HTMLSelectElement, next = Number(target.value);
  if (editor.isToolPending("rules") && !await editor.guardChanges()) { target.value = String(selected.value); return; }
  selected.value = next;
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
    Home: -sections.value.length,
    End: sections.value.length,
  };
  const delta = keys[event.key];
  if (delta === undefined) return;
  event.preventDefault();
  const current = sections.value.indexOf(section.value);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? sections.value.length - 1
        : (current + delta + sections.value.length) % sections.value.length;
  section.value = sections.value[next]!;
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
          <span v-if="(item === 'tools' && editor.toolPending.value) || (item === 'advanced' && jsonPending)" class="mr-designer-pending-dot" aria-hidden="true"></span>
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
            @click="canvas.clearLocks(); editor.undo()"
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
            @click="canvas.clearLocks(); editor.redo()"
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
          :title="saveReason || m.save"
          :aria-describedby="pendingConfigurations.length ? `${id}-pending` : saveReason ? `${id}-save-reason` : undefined"
          :disabled="
            readonly ||
            blocked ||
            jsonPending ||
            editor.toolPending.value ||
            !!editor.fieldChange.value ||
            !validation.ok ||
            !pendingLocalChanges
          "
          @click="editor.save"
        >
          <ReportIcon name="file" :size="13" />{{ saving ? m.saving : m.save }}
        </button>
        <span v-if="save && saveReason && !pendingConfigurations.length" :id="`${id}-save-reason`" class="mr-designer-save-reason">{{ saveReason }}</span>
      </div>
    </header>
    <TemplateRecoveryPanel :recovery="editor.recovery" :conflict="editor.conflict" :readonly="readonly" :can-load="!!loadLatest" :can-copy="!!keepCopy" :messages="recoveryMessages" />
    <TemplateFieldImpactPanel :messages="productMessages" :change="editor.fieldChange.value" :disabled="editDisabled" @confirm="editor.confirmFieldChange" @cancel="editor.cancelFieldChange" @locate="locateReview" />
    <div v-if="pendingConfigurations.length" :id="`${id}-pending`" class="mr-designer-pending" role="status">
      <span>{{ m.pendingToolsLabel }}</span>
      <button v-for="item in pendingConfigurations" :key="item.target" type="button" :aria-label="`${item.label} · ${m.unapplied} · ${m.returnToConfiguration}`" @click="openPending(item.target)">{{ item.label }}<span>{{ m.unapplied }} ↗</span></button>
      <small>{{ m.pendingToolsHint }}</small>
    </div>
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
        :key="editor.toolEpoch.value"
        class="mr-designer-tools"
      >
        <nav class="mr-designer-tool-tabs" :aria-label="m.toolsSection">
          <button
            v-for="item in ['outline', 'reuse', 'excel', 'rules', 'params', 'review'] as const"
            :key="item"
            :id="`${id}-tool-${item}`"
            type="button"
            :aria-pressed="tool === item"
            :aria-describedby="editor.isToolPending(item) ? `${id}-pending` : undefined"
            @click="tool = item"
          >
            {{ m[`${item}Tool`] }}
            <span v-if="editor.isToolPending(item)" class="mr-designer-pending-dot" aria-hidden="true"></span>
</button><span>{{ m.toolsDescription }}</span>
        </nav>
        <div class="mr-designer-tool-content">
          <TemplateOutlinePanel :messages="productMessages" v-if="visitedTools.has('outline')" v-show="tool === 'outline'" :document="draft" :selection="canvasSelection" @locate="locateReview" />
          <TemplateReusePanel :messages="productMessages" v-if="visitedTools.has('reuse')" v-show="tool === 'reuse'" :document="draft" :page-index="canvasPage" :selection="canvasSelection" :fragments="fragments" :styles="documentStyles" :disabled="editDisabled" :accept="editor.transaction" @select="chooseCanvas" />
          <ParamEditor
            v-if="visitedTools.has('params')"
            v-show="tool === 'params'"
            :document="draft"
            :readonly="editDisabled"
            :accept="acceptParams"
            @dirty="editor.setToolPending('params', $event)"
          />
          <ExcelBindingWizard
            v-if="visitedTools.has('excel')"
            v-show="tool === 'excel'"
            :datasets="bindingDatasets ?? []"
            :session="bindingSession"
            :identity="{ id: draft.id, name: draft.name }"
            lock-id
            :readonly="editDisabled"
            :accept="acceptExcel"
            @dirty="editor.setToolPending('excel', $event)"
          /><TemplateReviewPanel
            v-if="visitedTools.has('review')"
            v-show="tool === 'review'"
            :document="draft"
            :previous="editor.originalDocument.value"
            :fixtures="reviewFixtures"
            :messages="reviewMessages"
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
              }}<select :value="selected" @change="chooseRuleList">
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
              :recovery-key="`rules:${lists[selected]?.pageIndex ?? 0}:${lists[selected]?.componentIndex ?? 0}`"
              :datasets="datasets"
              :dataset-schema="dataSchema"
              :dataset-schemas="dataSchemas"
              :readonly="editDisabled"
              @change="changeList"
              @dirty="editor.setToolPending('rules', $event)"
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
          <div v-if="canvasFlow || fieldFlow" class="mr-designer-flow-note"><small>{{ m.flowLayout }}</small><button type="button" @click="openBinding">{{ m.excelTool }} ↗</button></div>
          <template v-if="section === 'fields'">
            <label v-if="lists.length > 1" class="mr-designer-area">{{ m.area
              }}<select :value="selected" @change="chooseRuleList">
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
                        :disabled="fieldFlow"
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
                    :disabled="fieldFlow || activeIndex <= 0"
                    @click="moveColumn(-1)"
                  >
                    <ReportIcon name="chevron-left" :size="13" />
</button><button
                    type="button"
                    :aria-label="m.moveColumnRight"
                    :title="m.moveColumnRight"
                    :disabled="fieldFlow || activeIndex >= activeList.columns.length - 1"
                    @click="moveColumn(1)"
                  >
                    <ReportIcon name="chevron-right" :size="13" />
</button><label>{{ m.columnVisible
                    }}<input
                      type="checkbox"
                      :checked="activeColumn.column.hidden !== true"
                      :disabled="
                        fieldFlow || activeColumn.column.hidden !== true &&
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
                :disabled="editDisabled || canvasFlow"
                @change="insertComponent"
              >
                <option value="">{{ m.insertComponent }}</option>
                <option value="text">{{ m.insertText }}</option>
                <option value="list" :disabled="!!draft.template.repeat">{{ m.insertList }}</option>
                <option value="image">{{ m.insertImage }}</option>
                <option value="rect">{{ m.insertRect }}</option>
                <option value="qrcode">{{ m.insertQrcode }}</option>
                <option value="barcode">{{ m.insertBarcode }}</option>
</select><button
                type="button"
                :title="m.duplicateComponent"
                :aria-label="m.duplicateComponent"
                :disabled="editDisabled || canvasFlow || !canvasActive"
                @click="canvas.duplicate"
              >
                ＋
</button><button
                type="button"
                :title="m.removeComponent"
                :aria-label="m.removeComponent"
                :disabled="editDisabled || canvasFlow || !canvasActive"
                @click="canvas.remove"
              >
                <ReportIcon name="close" :size="14" />
              </button>
            </div>
            <label v-if="draft.template.pages.length > 1">{{ m.page
              }}<select v-model.number="canvasPage">
                <option
                  v-for="(page, pageIndex) in draft.template.pages"
                  :key="pageIndex"
                  :value="pageIndex"
                >
                  {{ pageName(page, pageIndex, m.page) }}
                </option>
              </select></label>
            <label class="mr-designer-stacked">{{ m.components
              }}<select
                :value="
                  canvasSelection && canvasSelection.pageIndex === canvasPage
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
                  v-for="item in componentDirectory"
                  :key="item.index"
                  :value="item.index"
                >
                  {{ item.index + 1 }} · {{ item.name }}
                </option>
              </select></label>
            <div v-if="canvas.selections.value.length" class="mr-designer-arrange"><strong>{{ canvas.selections.value.length }} {{ m.component }}</strong><button type="button" :disabled="editDisabled" @click="canvas.toggleLock">{{ canvas.allLocked.value ? m.unlockSelection : m.lockSelection }}</button><select :aria-label="m.alignSelection" :disabled="editDisabled || canvasFlow || canvas.selections.value.length < 2" @change="canvas.align(value($event) as Parameters<typeof canvas.align>[0]); ($event.target as HTMLSelectElement).value = ''"><option value="">{{ m.alignSelection }}</option><option value="left">{{ m.leftEdges }}</option><option value="center">{{ m.centers }}</option><option value="right">{{ m.rightEdges }}</option><option value="top">{{ m.topEdges }}</option><option value="middle">{{ m.middles }}</option><option value="bottom">{{ m.bottomEdges }}</option></select><button type="button" :disabled="editDisabled || canvasFlow || canvas.selections.value.length < 3" @click="canvas.distribute('horizontal')">{{ m.horizontalSpacing }}</button><button type="button" :disabled="editDisabled || canvasFlow || canvas.selections.value.length < 3" @click="canvas.distribute('vertical')">{{ m.verticalSpacing }}</button><small v-if="canvas.allLocked.value">{{ m.sessionLock }}</small></div>
            <template v-if="canvasActive">
              <div class="mr-designer-layer-tools">
                <button
                  type="button"
                  :disabled="
                    editDisabled || canvasFlow || canvasSelection?.componentIndex === 0
                  "
                  @click="canvas.reorder(-1)"
                >
                  {{ m.backward }}
</button><button
                  type="button"
                  :disabled="
                    editDisabled || canvasFlow ||
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
                :geometry-disabled="canvasFlow"
                :disabled="editDisabled || canvas.locked(canvasSelection)"
                :messages="m"
                :repeat="draft.template.repeat"
                :schema="repeatSchema"
                @geometry="canvas.geometry"
                @patch="patchCanvas"
              /><HeaderStructureEditor
                v-if="canvasActive.kind === 'list'"
                :list="canvasActive"
                :disabled="editDisabled || canvasFlow"
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
            <TemplatePageInspector :document="draft" :page-index="canvasPage" :disabled="editDisabled" :messages="m" @select="canvasPage = $event" @command="pageCommand" @locate="chooseCanvas({ pageIndex: canvasPage, componentIndex: $event }); setMode('design')" />
            <TemplateRepeatInspector :document="draft" :datasets="Object.keys(datasets ?? {})" :schemas="dataSchemas" :disabled="editDisabled" :messages="m" @change="editor.transaction(document => { if ($event) document.template.repeat = $event; else delete document.template.repeat; })" />
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
          :selections="canvas.selections.value"
          :locked="canvas.locked"
          :active-column-index="activeIndex"
          :page-index="canvasPage"
          :datasets="datasets"
          :disabled="editDisabled || canvasFlow || editor.isToolPending('rules')"
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
