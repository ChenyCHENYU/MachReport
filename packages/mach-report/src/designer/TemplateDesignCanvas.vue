<script setup lang="ts">
import { resolveListSampleCell, resolveListHeaderStyle } from "../layout/list-cell";
import { designListSamples } from "./tree-samples";
import { useCanvasViewport } from "./useCanvasViewport";
import { resolveFontSize } from "../render/style";
import { computed, onBeforeUnmount, watch } from "vue";
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
const { viewport, zoom, scale, page, wide, fraction, fit, sync, navigate } = useCanvasViewport({ get document() { return props.document; }, get pageIndex() { return props.pageIndex; }, get selection() { return props.selection; }, get columnIndex() { return props.activeColumnIndex; } });
const geometryDisabled = computed(() => props.disabled === true || props.geometryDisabled === true || !!page.value.flow);
const samples = computed(() => page.value.components.map(component => component.kind === "list" ? designListSamples(component, props.datasets?.[component.dataset] ?? [], page.value.flow || component.cardinality === "record" ? 1 : 3) : []));
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
      <span>{{ m.canvasHint }}</span><nav class="mr-canvas-view-tools"><button type="button" @click="fit('width')">{{ m.fitWidth }}</button><button type="button" @click="fit('page')">{{ m.fitPage }}</button><button type="button" :disabled="!selection" @click="fit('selection')">{{ m.fitSelection }}</button></nav><label>{{ m.zoom
        }}<select v-model.number="zoom" :aria-label="m.zoom"><option v-if="![.5,.8,1,1.25].includes(zoom)" :value="zoom">{{ Math.round(zoom * 100) }}%</option>
          <option :value="0.5">50%</option>
          <option :value="0.8">80%</option>
          <option :value="1">100%</option>
          <option :value="1.25">125%</option>
        </select></label>
    </div>
    <div ref="viewport" class="mr-canvas-scroll" @scroll.passive="sync">
      <div
        class="mr-canvas-paper"
        :style="{
          width: `${page.widthMm * scale}px`,
          height: `${page.heightMm * scale}px`,
        }"
      >
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
          <img
            v-else-if="component.imageData"
            :src="component.imageData"
            alt=""
            draggable="false"
          />
          <div
            v-else
            class="mr-canvas-content"
            :style="{
              color: component.style?.color,
              backgroundColor: component.style?.backgroundColor,
              fontWeight: component.style?.bold ? '700' : '400',
              fontSize: `${resolveFontSize(component.style).fontSizePx * zoom}px`,
              textAlign: component.style?.align,
            }"
          >
            {{
              component.text ??
              component.fallbackText ??
              (component.kind === "rect" ? "" : component.kind)
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
  gap: 12px;
  padding: 8px 12px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  color: #64748b;
  font-size: 11px;
}
.mr-canvas-view-tools { display:flex; gap:4px; margin-left:auto; }.mr-canvas-view-tools button { border:1px solid #dbe3ec; background:#fff; color:inherit; border-radius:4px; padding:3px 7px; font:inherit; cursor:pointer; }.mr-canvas-view-tools button:disabled { opacity:.5; }.mr-canvas-navigator { display:flex; align-items:center; gap:10px; padding:5px 12px; background:#fff; border-top:1px solid #e2e8f0; font-size:11px; color:#64748b; }.mr-canvas-navigator input { flex:1; min-width:80px; height:16px; accent-color:#3b82f6; }.mr-canvas-component.is-locked { cursor:default; border-style:solid; border-color:#94a3b8; }
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
