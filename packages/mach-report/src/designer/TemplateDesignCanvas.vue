<script setup lang="ts">
import { resolveListSampleCell, resolveListHeaderStyle } from "../layout/list-cell";
import { designListSamples } from "./tree-samples";
import { useCanvasViewport } from "./useCanvasViewport";
import { resolveFontSize } from "../render/style";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { canvasContentSample, canvasRulerMarks } from "./canvas-samples";
import { pageName } from "./page-commands";
import {
  resolveGridLayout,
  type DatasetRows,
  type ListComponent,
  type PlanComponent,
  type ReportTemplateDocument,
} from "@agile-team/mach-report";
import {
  componentGeometry,
  componentHeight,
  type CanvasGeometry,
  type CanvasSelection,
} from "./canvas-commands";
import { useCanvasPointer } from "./useCanvasPointer";
import {
  TEMPLATE_EDITOR_MESSAGES,
  type TemplateEditorMessages,
} from "./messages";
const props = defineProps<{
  document: ReportTemplateDocument;
  selection?: CanvasSelection;
  selections?: readonly CanvasSelection[];
  locked?: (selection: CanvasSelection) => boolean;
  activeColumnIndex?: number;
  pageIndex: number;
  datasets?: DatasetRows;
  disabled?: boolean;
  geometryDisabled?: boolean;
  messages?: Partial<TemplateEditorMessages>;
}>();
const emit = defineEmits<{
  (event: "select", value: CanvasSelection): void;
  (event: "geometry", value: CanvasGeometry): void;
  (event: "column", value: number): void;
  (event: "width", index: number, value: number): void;
}>();
const m = computed(() => ({ ...TEMPLATE_EDITOR_MESSAGES, ...props.messages }));
const { viewport, zoom, scale, page, wide, fraction, fit, setZoom, sync, navigate } = useCanvasViewport({ get document() { return props.document; }, get pageIndex() { return props.pageIndex; }, get selection() { return props.selection; }, get columnIndex() { return props.activeColumnIndex; } });
const geometryDisabled = computed(() => props.disabled === true || props.geometryDisabled === true || !!page.value.flow);
const samples = computed(() => page.value.components.map(component => component.kind === "list" ? designListSamples(component, props.datasets?.[component.dataset] ?? [], page.value.flow || component.cardinality === "record" ? 1 : 3) : []));
const contentSamples = computed(() => page.value.components.map(component => canvasContentSample(component, props.document, props.datasets)));
const rulers = ref(true);
const horizontalMarks = computed(() => canvasRulerMarks(page.value.widthMm, scale.value));
const verticalMarks = computed(() => canvasRulerMarks(page.value.heightMm, scale.value));
function sampleStyle(cell: ReturnType<typeof resolveListSampleCell>, width: number, hidden?: boolean) {
  return { width: `${width * scale.value}px`, opacity: hidden ? .35 : 1, textAlign: cell.style?.align, paddingLeft: cell.indentMm ? `${cell.indentMm * scale.value}px` : undefined, color: cell.style?.color, backgroundColor: cell.style?.backgroundColor, fontWeight: cell.style?.bold ? "700" : "400", fontSize: `${resolveFontSize(cell.style).fontSizePx * zoom.value}px` };
}
function isLocked(index: number): boolean { return props.locked?.({ pageIndex: props.pageIndex, componentIndex: index }) === true; }
function selectPointer(event: PointerEvent, index: number): void {
  emit("select", { pageIndex: props.pageIndex, componentIndex: index, additive: event.ctrlKey || event.metaKey || event.shiftKey });
  if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !isLocked(index)) pointer.start(event, page.value.components[index]!);
}
const pointer = useCanvasPointer({
  scale,
  page: () => page.value,
  disabled: () => geometryDisabled.value,
  commit: (value) => emit("geometry", value),
});
function selected(index: number): boolean {
  return (
    (props.selections ?? (props.selection ? [props.selection] : [])).some(item => item.pageIndex === props.pageIndex && item.componentIndex === index)
  );
}
function style(index: number) {
  const item = page.value.components[index]!;
  const id = item.kind === "list" ? item.id : item.nid;
  const band = page.value.flow?.bands.find(item => item.componentIds.includes(id ?? ""));
  const height = band && item.kind === "list" ? band.topMm + band.heightMm - item.topMm : componentHeight(item);
  return {
    left: `${item.leftMm * scale.value}px`,
    top: `${item.topMm * scale.value}px`,
    width: `${item.widthMm * scale.value}px`,
    height: `${height * scale.value}px`,
  };
}
function keyboard(event: KeyboardEvent, index: number): void {
  const component = page.value.components[index]!;
  if (geometryDisabled.value || isLocked(index) || !selected(index)) return;
  const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    },
    delta = directions[event.key];
  if (!delta) return;
  event.preventDefault();
  event.stopPropagation();
  const next = componentGeometry(component),
    step = event.shiftKey ? 5 : 0.5;
  next.leftMm += delta[0] * step;
  next.topMm += delta[1] * step;
  emit("geometry", next);
}
function columnEdges(list: ListComponent): number[] {
  let width = 0;
  return list.columns.map((column) => {
    width += column.widthMm;
    return width;
  });
}
function staticCells(component: PlanComponent) {
  return component.grid
    ? resolveGridLayout(
        component.grid,
        component.widthMm,
        component.heightMm,
      ).cells.slice(0, 2000)
    : [];
}
function headerCells(list: ListComponent) {
  return list.headerGrid
    ? resolveGridLayout(
        list.headerGrid,
        list.widthMm,
        list.headerGrid.rowHeightsMm?.reduce(
          (sum, height) => sum + height,
          0,
        ) ?? list.headerGrid.cells.length * 8,
      ).cells
    : [];
}
let cancelColumn: (() => void) | undefined;
watch(
  () => geometryDisabled.value,
  (disabled) => {
    if (disabled) cancelColumn?.();
  },
);
watch(
  () => props.document,
  () => cancelColumn?.(),
);
onBeforeUnmount(() => cancelColumn?.());
function resizeColumn(
  event: PointerEvent,
  list: ListComponent,
  index: number,
): void {
  if (geometryDisabled.value || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  cancelColumn?.();
  const start = event.clientX,
    original = list.columns[index]!.widthMm;
  let width = original;
  const handle = event.currentTarget as HTMLElement;
  const move = (next: PointerEvent) => {
    width = Math.max(
      2,
      Math.round((original + (next.clientX - start) / scale.value) * 2) / 2,
    );
    handle.style.transform = `translateX(${(width - original) * scale.value}px)`;
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", escape);
    handle.style.transform = "";
    cancelColumn = undefined;
  };
  const finish = () => {
      stop();
      if (width !== original) emit("width", index, width);
    },
    cancel = () => stop();
  const escape = (key: KeyboardEvent) => {
    if (key.key === "Escape") {
      key.preventDefault();
      cancel();
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", escape);
  cancelColumn = cancel;
}
</script>
<template>
  <div class="mr-canvas">
    <div class="mr-canvas-heading">
      <div class="mr-canvas-sheet-info">
        <strong :title="pageName(page, pageIndex, m.page)">{{ pageName(page, pageIndex, m.page) }}</strong>
        <span>{{ page.widthMm }} × {{ page.heightMm }} mm</span>
        <small v-if="document.template.repeat" :title="document.template.repeat.dataset">{{ m.designSample }} · {{ document.template.repeat.dataset }}</small>
      </div>
      <span class="mr-canvas-gesture-hint">{{ m.canvasHint }}</span>
      <div class="mr-canvas-toolbar">
        <nav class="mr-canvas-view-tools">
          <button type="button" :aria-pressed="rulers" @click="rulers = !rulers">{{ m.rulerToggle }}</button>
          <button type="button" @click="fit('width')">{{ m.fitWidth }}</button>
          <button type="button" @click="fit('page')">{{ m.fitPage }}</button>
          <button type="button" :disabled="!selection" @click="fit('selection')">{{ m.fitSelection }}</button>
        </nav>
        <label>{{ m.zoom }}<select :value="zoom" :aria-label="m.zoom" @change="setZoom(Number(($event.target as HTMLSelectElement).value))">
          <option v-if="![.5,.8,1,1.25].includes(zoom)" :value="zoom">{{ Math.round(zoom * 100) }}%</option>
          <option :value="0.5">50%</option>
          <option :value="0.8">80%</option>
          <option :value="1">100%</option>
          <option :value="1.25">125%</option>
        </select></label>
      </div>
    </div>
    <div ref="viewport" class="mr-canvas-scroll" @scroll.passive="sync">
      <div
        class="mr-canvas-paper"
        :style="{
          width: `${page.widthMm * scale}px`,
          height: `${page.heightMm * scale}px`,
        }"
      >
        <svg v-if="rulers" class="mr-canvas-ruler is-horizontal" :width="page.widthMm * scale" height="17" :aria-label="m.rulerLabel" role="img"><g v-for="mark in horizontalMarks" :key="mark.mm" :transform="`translate(${mark.position}, 0)`"><line y1="12" y2="17" /><text x="3" y="9">{{ mark.mm }}</text></g></svg>
        <svg v-if="rulers" class="mr-canvas-ruler is-vertical" width="17" :height="page.heightMm * scale" aria-hidden="true"><g v-for="mark in verticalMarks" :key="mark.mm" :transform="`translate(0, ${mark.position})`"><line x1="12" x2="17" /><text x="3" y="10">{{ mark.mm }}</text></g></svg>
        <div
          v-for="(component, index) in page.components"
          :key="index"
          class="mr-canvas-component"
          :class="{ 'is-selected': selected(index), 'is-locked': isLocked(index) }"
          :data-canvas-component="index"
          :style="style(index)"
          role="button"
          :aria-label="`${m.component} ${index + 1} ${component.kind}`"
          :aria-pressed="selected(index)"
          :tabindex="selected(index) ? 0 : -1"
          @focus="!selected(index) && emit('select', { pageIndex, componentIndex: index })"
          @pointerdown="selectPointer($event, index)"
          @click="($event.detail === 0 && !selected(index)) && emit('select', { pageIndex, componentIndex: index })"
          @keydown="keyboard($event, index)"
        >
          <template v-if="component.kind === 'list'">
            <div class="mr-canvas-table">
              <div
                v-if="component.header !== false && component.headerGrid"
                class="mr-canvas-merged"
                :style="{
                  height: `${(component.headerGrid.rowHeightsMm?.reduce((a, b) => a + b, 0) ?? component.headerGrid.cells.length * 8) * scale}px`,
                }"
              >
                <div
                  v-for="(box, cellIndex) in headerCells(component)"
                  :key="cellIndex"
                  :style="{
                    left: `${box.xMm * scale}px`,
                    top: `${box.yMm * scale}px`,
                    width: `${box.widthMm * scale}px`,
                    height: `${box.heightMm * scale}px`,
                    textAlign: box.cell.style?.align ?? 'center',
                  }"
                >
                  {{ box.cell.text }}
                </div>
              </div>
              <div v-else-if="component.header !== false" class="mr-canvas-table-row is-header">
                <div
                  v-for="(column, columnIndex) in component.columns"
                  :key="columnIndex"
                  :style="sampleStyle({ text: column.header, style: resolveListHeaderStyle(component, column) }, column.widthMm, column.hidden)"
                  @pointerdown.stop="
                    emit('select', { pageIndex, componentIndex: index });
                    emit('column', columnIndex);
                  "
                >
                  {{ column.header }}
                </div>
              </div>
              <div
                v-for="(row, rowIndex) in samples[index]"
                :key="rowIndex"
                class="mr-canvas-table-row"
              >
                <div
                  v-for="(column, columnIndex) in component.columns"
                  :key="columnIndex"
                  :style="sampleStyle(row[columnIndex]!, column.widthMm, column.hidden)"
                >
                  {{ row[columnIndex]!.text }}
                </div>
              </div>
              <div
                v-if="!samples[index]?.length"
                class="mr-canvas-placeholder"
              >
                {{ component.dataset }} · {{ component.tree && datasets?.[component.dataset]?.length ? m.treeSampleHint : m.sampleRows }}
              </div>
            </div>
            <template v-if="selected(index) && !geometryDisabled && !isLocked(index)">
              <span
                v-for="(edge, columnIndex) in columnEdges(component)"
                :key="columnIndex"
                class="mr-canvas-column-handle"
                :aria-label="`${m.resizeColumn} ${component.columns[columnIndex]?.header}`"
                role="separator"
                aria-orientation="vertical"
                :style="{ left: `${edge * scale}px` }"
                @pointerdown="resizeColumn($event, component, columnIndex)"
              />
            </template>
          </template>
          <div v-else-if="component.grid" class="mr-canvas-static-grid">
            <div
              v-for="(box, cellIndex) in staticCells(component)"
              :key="cellIndex"
              :style="{
                left: `${box.xMm * scale}px`,
                top: `${box.yMm * scale}px`,
                width: `${box.widthMm * scale}px`,
                height: `${box.heightMm * scale}px`,
                backgroundColor: box.cell.style?.backgroundColor,
                color: box.cell.style?.color,
                fontWeight: box.cell.style?.bold ? '700' : '400',
                fontSize: `${resolveFontSize(box.cell.style).fontSizePx * zoom}px`,
                textAlign: box.cell.style?.align ?? 'left',
              }"
            >
              {{ box.cell.text }}
            </div>
            <span
              v-if="
                component.grid.cells.reduce((sum, row) => sum + row.length, 0) >
                2000
              "
              class="mr-canvas-grid-limit"
              >{{ m.canvasGridLimited }}</span>
          </div>
          <div v-else-if="(component.kind === 'barcode' || component.kind === 'qrcode') && !contentSamples[index]?.image" class="mr-canvas-code" :class="{ 'is-error': contentSamples[index]?.error }" :title="contentSamples[index]?.error ?? m.codePreviewHint">
            <svg viewBox="0 0 32 24" aria-hidden="true"><rect x="3" y="3" width="26" height="18" rx="2" /><path d="M10 8 6 12l4 4m12-8 4 4-4 4m-8 2 4-12" /></svg><strong>{{ component.kind === 'qrcode' ? m.insertQrcode : (component.code?.symbology ?? 'code128').toUpperCase() }}</strong><span>{{ contentSamples[index]?.text || m.codePlaceholder }}</span><small v-if="contentSamples[index]?.bound">{{ component.binding?.field }}</small>
          </div>
          <img
            v-else-if="contentSamples[index]?.image"
            :src="contentSamples[index]?.image"
            alt=""
            draggable="false"
          />
          <div
            v-else
            class="mr-canvas-content"
            :class="{ 'is-binding-error': contentSamples[index]?.error, 'is-bound-image': component.kind === 'image' && component.binding }"
            :title="contentSamples[index]?.error === 'image-binding' ? m.bindingImageHint : contentSamples[index]?.error"
            :style="{
              color: component.style?.color,
              backgroundColor: component.style?.backgroundColor,
              fontWeight: component.style?.bold ? '700' : '400',
              fontSize: `${resolveFontSize(component.style).fontSizePx * zoom}px`,
              textAlign: component.style?.align,
              justifyContent: component.style?.verticalAlign === 'bottom' ? 'flex-end' : component.style?.verticalAlign === 'middle' ? 'center' : 'flex-start',
            }"
          >
            {{
              contentSamples[index]?.text || (component.kind === "rect" ? "" : component.kind === "image" && component.binding ? m.boundImagePlaceholder : "")
            }}
          </div>
          <span
            v-if="selected(index) && !geometryDisabled && !isLocked(index)"
            class="mr-canvas-resize"
            :aria-label="m.resizeComponent"
            role="separator"
            @pointerdown="pointer.start($event, component, true)"
          />
        </div>
      </div>
    </div>
    <footer v-if="wide" class="mr-canvas-navigator"><span>{{ m.wideNavigation }}</span><input type="range" min="0" max="100" :value="fraction" :aria-label="m.wideNavigation" @input="navigate(Number(($event.target as HTMLInputElement).value))" /><span>{{ fraction }}%</span></footer>
  </div>
</template>
<style scoped>
.mr-canvas {
  container-type: inline-size;
  container-name: mr-design-canvas;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  color: #334155;
  font:
    12px/1.5 system-ui,
    sans-serif;
}
.mr-canvas-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  color: #64748b;
  font-size: 11px;
}
.mr-canvas-sheet-info { display:flex; align-items:center; gap:8px; flex:0 1 280px; min-width:0; white-space:nowrap; }
.mr-canvas-sheet-info strong { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; font-size:11px; font-weight:600; color:#47698e; }
.mr-canvas-sheet-info > span { flex-shrink:0; font:10px/1.5 ui-monospace,monospace; color:#7187a0; }
.mr-canvas-sheet-info small { flex:0 1 120px; min-width:0; overflow:hidden; text-overflow:ellipsis; padding:2px 5px; background:#eff6ff; border-radius:4px; color:#6b88ab; font-size:9px; }
.mr-canvas-gesture-hint { flex:1; min-width:80px; font-size:10px; color:#8b9bae; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mr-canvas-toolbar { display:flex; flex:0 0 auto; flex-wrap:wrap; justify-content:flex-end; align-items:center; gap:10px; min-width:0; margin-left:auto; }
.mr-canvas-toolbar button, .mr-canvas-toolbar label { flex-shrink:0; white-space:nowrap; }
.mr-canvas-toolbar select { width:auto; flex-shrink:0; }
@container mr-design-canvas (max-width:760px) {
  .mr-canvas-sheet-info { flex:1 1 100%; }
  .mr-canvas-gesture-hint { display:none; }
  .mr-canvas-toolbar { flex:1 1 100%; }
}
@container mr-design-canvas (max-width:420px) {
  .mr-canvas-sheet-info small { display:none; }
  .mr-canvas-toolbar { justify-content:flex-start; }
}
.mr-canvas-ruler{position:absolute;pointer-events:none;overflow:visible;background:#f8fafc;color:#94a3b8;font:8px/1 ui-monospace,monospace}.mr-canvas-ruler.is-horizontal{left:0;top:-18px}.mr-canvas-ruler.is-vertical{left:-18px;top:0}.mr-canvas-ruler line{stroke:#a9b8cb;stroke-width:1}.mr-canvas-ruler text{fill:#8193aa}.mr-canvas-code{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:3px;height:100%;padding:4px;background:#f8fbff;color:#5b789b;overflow:hidden;text-align:center}.mr-canvas-code svg{height:26px;max-height:35%;width:36px;fill:none;stroke:#a2b9d6;stroke-width:1.5}.mr-canvas-code strong{font-size:10px;font-weight:600}.mr-canvas-code span{max-width:100%;font:9px/1.3 ui-monospace,monospace;overflow-wrap:anywhere}.mr-canvas-code small{max-width:100%;font-size:8px;color:#8da3bc;overflow-wrap:anywhere}.mr-canvas-code.is-error,.mr-canvas-content.is-binding-error{color:#a45b35;background:#fff9f2}.mr-canvas-content.is-bound-image{color:#829bb8;background:#f4f8fe;text-align:center}.mr-canvas-view-tools button[aria-pressed=true]{color:#2563eb;background:#eff6ff;border-color:#bad1f1}
.mr-canvas-view-tools { display:flex; flex-shrink:0; gap:4px; }.mr-canvas-view-tools button { border:1px solid #dbe3ec; background:#fff; color:inherit; border-radius:4px; padding:3px 7px; font:inherit; white-space:nowrap; flex-shrink:0; cursor:pointer; }.mr-canvas-view-tools button:disabled { opacity:.5; }.mr-canvas-navigator { display:flex; align-items:center; gap:10px; padding:5px 12px; background:#fff; border-top:1px solid #e2e8f0; font-size:11px; color:#64748b; }.mr-canvas-navigator input { flex:1; min-width:80px; height:16px; accent-color:#3b82f6; }.mr-canvas-component.is-locked { cursor:default; border-style:solid; border-color:#94a3b8; }
.mr-canvas-heading label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mr-canvas-heading select {
  font: inherit;
  color: inherit;
  background: #fff;
  border: 1px solid #dbe3ec;
  border-radius: 4px;
  padding: 3px;
}
.mr-canvas-scroll {
  overflow: auto;
  min-height: 0;
  flex: 1;
  padding: 20px;
  background-color: #f1f5f9;
  background-image: radial-gradient(#cbd5e1 0.7px, transparent 0.7px);
  background-size: 10px 10px;
}
.mr-canvas-paper:before,
.mr-canvas-paper:after {
  content: "";
  position: absolute;
  pointer-events: none;
  z-index: 5;
  background: #60a5fa;
}
.mr-canvas-paper:before {
  display: var(--mr-canvas-guide-x-display, none);
  left: var(--mr-canvas-guide-x, 0);
  top: 0;
  bottom: 0;
  width: 1px;
}
.mr-canvas-paper:after {
  display: var(--mr-canvas-guide-y-display, none);
  top: var(--mr-canvas-guide-y, 0);
  left: 0;
  right: 0;
  height: 1px;
}
.mr-canvas-paper {
  position: relative;
  background: #fff;
  box-shadow: 0 3px 15px #1e3a5f12;
  min-width: 1px;
}
.mr-canvas-component {
  position: absolute;
  box-sizing: border-box;
  border: 1px dashed #cbd5e1;
  cursor: move;
  outline: 0;
  touch-action: none;
  user-select: none;
}
.mr-canvas-component:hover {
  border-color: #93b5e4;
}
.mr-canvas-component.is-selected {
  outline: 1.5px solid #2563eb;
  outline-offset: 0;
}
.mr-canvas-component:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 3px;
}
.mr-canvas-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  white-space: pre-wrap;
  overflow: hidden;
  padding: 2px;
  box-sizing: border-box;
}
.mr-canvas-component img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
.mr-canvas-resize {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 8px;
  height: 8px;
  border: 1px solid #2563eb;
  background: #fff;
  cursor: nwse-resize;
  z-index: 3;
}
.mr-canvas-table {
  height: 100%;
  overflow: hidden;
  background: #fff;
  font-size: 10px;
}
.mr-canvas-table-row {
  display: flex;
  height: 25%;
  min-height: 20px;
}
.mr-canvas-table-row > div {
  flex-shrink: 0;
  border-right: 1px solid #dbe3ec;
  border-bottom: 1px solid #dbe3ec;
  padding: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  box-sizing: border-box;
}
.mr-canvas-table-row.is-header {
  background: #eaf2fc;
  color: #284d7b;
  font-weight: 600;
  text-align: center;
}
.mr-canvas-column-handle {
  position: absolute;
  top: 0;
  height: 100%;
  width: 7px;
  margin-left: -3px;
  cursor: col-resize;
  z-index: 2;
}
.mr-canvas-column-handle:hover {
  background: #2563eb30;
}
.mr-canvas-merged {
  position: relative;
  background: #eaf2fc;
}
.mr-canvas-merged > div {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border: 1px solid #dbe3ec;
  overflow: hidden;
  padding: 2px;
  font-size: 10px;
}
.mr-canvas-static-grid {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.mr-canvas-static-grid > div {
  position: absolute;
  border: 1px solid #dbe3ec;
  box-sizing: border-box;
  padding: 2px;
  overflow: hidden;
  white-space: pre-wrap;
  font-size: 10px;
}
.mr-canvas-grid-limit {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 4px;
  padding: 4px;
  color: #475569;
  background: #eff6ff;
  font-size: 10px;
}
.mr-canvas-placeholder {
  display: grid;
  place-content: center;
  min-height: 40px;
  color: #94a3b8;
  background: #f8fafc;
}
</style>
