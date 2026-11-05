<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import type { DatasetContract } from "@agile-team/mach-report";
import type { CanvasInsertKind } from "./canvas-commands";
import {
  DESIGNER_INSERT_MESSAGES,
  type DesignerInsertMessages,
} from "./insertion-messages";
const props = defineProps<{
  disabled?: boolean;
  repeat?: boolean;
  fields?: DatasetContract["fields"];
  columns?: boolean;
  usedFields?: string[];
  messages?: Partial<DesignerInsertMessages>;
}>();
const emit = defineEmits<{
  (event: "insert", kind: CanvasInsertKind): void;
  (event: "field", field: string): void;
}>();
const m = computed(() => ({ ...DESIGNER_INSERT_MESSAGES, ...props.messages }));
const open = ref(false),
  choosingField = ref(false),
  query = ref("");
const trigger = ref<HTMLButtonElement>(),
  search = ref<HTMLInputElement>();
const items = computed(() =>
  (
    ["text", "qrcode", "barcode", "image", "list", "chart", "rect"] as const
  ).filter((kind) => !props.repeat || !["list", "chart"].includes(kind)),
);
const visibleFields = computed(() =>
  (props.fields ?? [])
    .filter((field) =>
      `${field.label ?? ""} ${field.field}`
        .toLowerCase()
        .includes(query.value.toLowerCase()),
    )
    .slice(0, 100),
);
const hints = computed(() => ({
  text: m.value.textHint,
  qrcode: m.value.codeHint,
  barcode: m.value.codeHint,
  image: m.value.imageHint,
  list: m.value.listHint,
  chart: m.value.chartHint,
  rect: m.value.rectHint,
}));
function close(): void {
  open.value = false;
  choosingField.value = false;
  query.value = "";
  trigger.value?.focus();
}
function insert(kind: CanvasInsertKind): void {
  emit("insert", kind);
  close();
}
async function chooseFields(): Promise<void> {
  choosingField.value = true;
  await nextTick();
  search.value?.focus();
}
function field(name: string): void {
  emit("field", name);
  close();
}
let focusFrame: number | undefined;
function dismiss(): void {
  open.value = false;
  choosingField.value = false;
  query.value = "";
}
function focusOut(event: FocusEvent): void {
  const container = event.currentTarget as HTMLElement;
  if (container.contains(event.relatedTarget as Node | null)) return;
  if (event.relatedTarget) {
    dismiss();
    return;
  }
  // Removing the focused menu item transfers focus to the field search.
  // Inspect it after the browser's focus transition and Vue's DOM update.
  if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
  focusFrame = requestAnimationFrame(() => {
    focusFrame = undefined;
    if (container.isConnected && !container.contains(document.activeElement)) dismiss();
  });
}
onBeforeUnmount(() => { if (focusFrame !== undefined) cancelAnimationFrame(focusFrame); });
</script>
<template>
  <div class="mr-insert" @keydown.esc.prevent.stop="close" @focusout="focusOut">
    <button
      ref="trigger"
      class="mr-insert-trigger"
      type="button"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="open = !open"
    >
      <span aria-hidden="true">＋</span>{{ m.add }}
    </button>
    <div
      v-if="open"
      class="mr-insert-panel"
      role="dialog"
      :aria-label="m.title"
    >
      <header>
        <strong>{{
          choosingField ? (columns ? m.columnField : m.field) : m.title
        }}</strong><button type="button" :aria-label="m.close" @click="close">×</button>
      </header>
      <template v-if="choosingField">
<button
          type="button"
          class="mr-insert-back"
          @click="choosingField = false"
        >
          ‹ {{ m.back }}
</button><input
          ref="search"
          v-model="query"
          :aria-label="m.search"
          :placeholder="m.search"
        />
        <div class="mr-insert-fields">
          <button
            v-for="item in visibleFields"
            :key="item.field"
            type="button"
            :disabled="columns && usedFields?.includes(item.field)" @click="field(item.field)"
          >
            <strong>{{ item.label || item.field }}</strong><small>{{ item.field }}</small>
          </button>
          <p v-if="!visibleFields.length">{{ m.noFields }}</p>
        </div>
</template>
      <div v-else class="mr-insert-grid">
        <button
          v-if="fields?.length"
          type="button"
          class="mr-insert-field"
          @click="chooseFields"
        >
          <strong>{{ columns ? m.columnField : m.field }}</strong><small>{{ m.fieldHint }}</small>
</button><button
          v-for="kind in items"
          :key="kind"
          type="button"
          @click="insert(kind)"
        >
          <strong>{{ m[kind] }}</strong><small>{{ hints[kind] }}</small>
        </button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.mr-insert {
  position: relative;
  flex: none;
}
.mr-insert-trigger {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 11px !important;
  border-color: #c8d9ee !important;
  background: #eef5ff !important;
  color: #255c95 !important;
  font-weight: 600;
}
.mr-insert-trigger span {
  font-size: 17px;
  line-height: 1;
}
.mr-insert-panel {
  position: absolute;
  z-index: 60;
  top: calc(100% + 8px);
  right: 0;
  width: 340px;
  max-width: calc(100vw - 40px);
  padding: 12px;
  border: 1px solid #dce6f2;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 14px 40px #17324d24;
  color: #334155;
}
.mr-insert-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.mr-insert-panel header button {
  border: 0;
  background: transparent;
  font-size: 20px;
  color: #64748b;
  cursor: pointer;
}
.mr-insert-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.mr-insert-grid button,
.mr-insert-fields button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  background: #fff;
  padding: 10px;
  text-align: left;
  cursor: pointer;
  color: inherit;
}
.mr-insert-grid button:hover,
.mr-insert-fields button:hover {
  background: #f1f7ff;
  border-color: #a9c5e8;
}
.mr-insert-grid small,
.mr-insert-fields small {
  font-size: 10px;
  color: #75869c;
  line-height: 1.5;
}
.mr-insert-field {
  grid-column: 1/-1;
  background: #f5f9ff !important;
}
.mr-insert-panel input {
  box-sizing: border-box;
  width: 100%;
  padding: 7px 9px;
  border: 1px solid #cfdaea;
  border-radius: 6px;
  font: inherit;
}
.mr-insert-back {
  margin: 0 0 8px;
  border: 0;
  background: transparent;
  color: #356da8;
  cursor: pointer;
}
.mr-insert-fields {
  display: grid;
  gap: 5px;
  max-height: 280px;
  overflow: auto;
  margin-top: 8px;
}
.mr-insert-panel :focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
</style>
