<script setup lang="ts">
import { resolveFontSize } from "../render/style";
import { computed, ref } from "vue";
import type { TemplateComponent } from "@agile-team/mach-report";
import AlignmentControl from "./AlignmentControl.vue";
import { componentGeometry, type CanvasGeometry } from "./canvas-commands";
import {
  TEMPLATE_EDITOR_MESSAGES,
  type TemplateEditorMessages,
} from "./messages";
const props = defineProps<{
  component: TemplateComponent;
  disabled?: boolean;
  /** Region layout is owned by the Excel binding recipe; styles/content remain editable. */
  geometryDisabled?: boolean;
  messages?: Partial<TemplateEditorMessages>;
}>();
const emit = defineEmits<{
  (event: "geometry", value: CanvasGeometry): void;
  (event: "patch", value: Record<string, unknown>): void;
}>();
const m = computed(() => ({ ...TEMPLATE_EDITOR_MESSAGES, ...props.messages })),
  error = ref("");
const dimensions = ["leftMm", "topMm", "widthMm", "heightMm"] as const;
const labels = computed(() => [
  m.value.leftPosition,
  m.value.topPosition,
  m.value.componentWidth,
  m.value.componentHeight,
]);
function geometry(key: keyof CanvasGeometry, event: Event): void {
  if (props.disabled || props.geometryDisabled) return;
  const number = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(number)) return;
  emit("geometry", { ...componentGeometry(props.component), [key]: number });
}
function style(key: string, value: unknown): void {
  if (props.component.kind === "list") return;
  const next = { ...props.component.style, [key]: value };
  if (key === "fontSize") delete next.fontSizePx;
  emit("patch", { style: next });
}
const alignLabels = computed(() => ({
  auto: m.value.auto,
  left: m.value.left,
  center: m.value.center,
  right: m.value.right,
  justify: m.value.justify,
}));
function input(event: Event): string {
  return (event.target as HTMLInputElement).value;
}
async function upload(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement,
    file = target.files?.[0];
  if (!file) return;
  error.value = "";
  const selected = props.component;
  try {
    if (
      file.size > 4 * 1024 * 1024 ||
      !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(
        file.type,
      )
    )
      throw new Error(m.value.imageBudget);
    const reader = new FileReader();
    const data = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    if (!props.disabled && props.component === selected)
      emit("patch", { imageData: data });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    target.value = "";
  }
}
</script>
<template>
  <fieldset class="mr-component-properties" :disabled="disabled">
    <h3>{{ m.positionGroup }}</h3>
    <div class="mr-component-dimensions">
      <label
        v-for="(key, index) in dimensions.filter(
          (key) => component.kind !== 'list' || key !== 'heightMm',
        )"
        :key="key"
        >{{ labels[index]
        }}<input
          type="number"
          step="0.5"
          :min="key === 'widthMm' || key === 'heightMm' ? 2 : 0"
          :value="componentGeometry(component)[key]"
          :disabled="geometryDisabled"
          @change="geometry(key, $event)"
      /></label>
    </div>
    <label v-if="component.kind !== 'list'">{{ m.repeatPage
      }}<select
        :value="component.pageAnchor ?? ''"
        :disabled="geometryDisabled"
        @change="emit('patch', { pageAnchor: input($event) || undefined })"
      >
        <option value="">{{ m.repeatNone }}</option>
        <option value="header">{{ m.repeatHeader }}</option>
        <option value="footer">{{ m.repeatFooter }}</option>
      </select></label>
    <h3>{{ m.componentContent }}</h3>
    <label v-if="component.kind === 'text'">{{ m.componentText
      }}<textarea
        rows="4"
        :value="component.text"
        @change="emit('patch', { text: input($event) })"
      />
    </label>
    <template v-if="component.kind === 'image'">
      <label>{{ m.imageSource
        }}<textarea
          rows="2"
          :value="component.imageData"
          @change="emit('patch', { imageData: input($event) })"
        /></label><label class="mr-component-upload">{{ m.imageUpload
        }}<input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          :aria-label="m.imageUpload"
          @change="upload"
      /></label>
      <p v-if="error" role="alert">{{ error }}</p>
    </template>
    <div v-if="component.kind === 'text'" class="mr-component-type">
      <h3>{{ m.textFormat }}</h3>
      <div class="mr-component-dimensions">
        <label>{{ m.fontSize
          }}<input
            type="number"
            min="1"
            max="200"
            :value="resolveFontSize(component.style).fontSizePt"
            @change="style('fontSize', Number(input($event)))"
/></label><label>{{ m.fontBold
          }}<input
            type="checkbox"
            :checked="component.style?.bold === true"
            @change="
              style('bold', ($event.target as HTMLInputElement).checked)
            "
        /></label>
      </div>
      <AlignmentControl
        :model-value="component.style?.align ?? 'left'"
        :label="m.bodyAlign"
        :labels="alignLabels"
        :auto-label="m.autoShort"
        @update:model-value="style('align', $event)"
      />
      <div class="mr-component-dimensions">
        <label>{{ m.textColor
          }}<input
            type="color"
            :value="component.style?.color ?? '#233c5c'"
            @change="style('color', input($event))"
/></label><label>{{ m.backgroundColor
          }}<input
            type="color"
            :value="component.style?.backgroundColor ?? '#ffffff'"
            @change="style('backgroundColor', input($event))"
        /></label>
      </div>
    </div>
    <label v-if="component.kind === 'list'">{{ m.listDataset
      }}<input
        :value="component.dataset"
        @change="emit('patch', { dataset: input($event) })"
    /></label>
  </fieldset>
</template>
<style scoped>
.mr-component-properties {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
  font:
    12px/1.5 system-ui,
    sans-serif;
  color: #334155;
}
.mr-component-properties h3 {
  font-size: 11px;
  color: #64748b;
  margin: 0 0 8px;
}
.mr-component-properties label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}
.mr-component-dimensions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 10px;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 12px;
}
.mr-component-properties input,
.mr-component-properties textarea,
.mr-component-properties select {
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #dbe3ec;
  border-radius: 5px;
  font: inherit;
  padding: 5px 7px;
  color: inherit;
  background: #fff;
}
.mr-component-properties :disabled {
  opacity: 0.45;
}
.mr-component-properties :focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
.mr-component-properties input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #2563eb;
}
.mr-component-type {
  margin-top: 12px;
}
.mr-component-type .mr-component-dimensions {
  border-bottom: 0;
  margin-top: 10px;
  margin-bottom: 0;
}
.mr-component-upload input {
  font-size: 10px;
}
.mr-component-properties [role="alert"] {
  color: #b91c1c;
  font-size: 11px;
}
</style>
