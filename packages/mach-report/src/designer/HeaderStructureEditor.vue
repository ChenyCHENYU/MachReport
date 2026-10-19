<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ListComponent } from "@agile-team/mach-report";
import {
  TEMPLATE_EDITOR_MESSAGES,
  type TemplateEditorMessages,
} from "./messages";
import type { HeaderCommand } from "./canvas-commands";
const props = defineProps<{
  list: ListComponent;
  disabled?: boolean;
  messages?: Partial<TemplateEditorMessages>;
}>();
const emit = defineEmits<{
  (event: "command", command: HeaderCommand): void;
}>();
const m = computed(() => ({ ...TEMPLATE_EDITOR_MESSAGES, ...props.messages }));
const row = ref(0),
  first = ref(0),
  last = ref(Math.min(1, props.list.columns.length - 1));
watch(
  () => props.list.columns.length,
  (count) => {
    first.value = Math.min(first.value, count - 1);
    last.value = Math.min(last.value, count - 1);
  },
);
</script>
<template>
  <details class="mr-header-editor">
    <summary>
      {{ m.headerStructure
      }}<span>{{ list.headerGrid?.cells.length ?? 1 }} {{ m.headerRow }}</span>
    </summary>
    <fieldset :disabled="disabled">
      <label>{{ m.headerRow
        }}<select v-model.number="row">
          <option
            v-for="index in list.headerGrid?.cells.length ?? 1"
            :key="index"
            :value="index - 1"
          >
            {{ index }}
          </option>
        </select></label><label>{{ m.headerFirst
        }}<select v-model.number="first">
          <option
            v-for="(column, index) in list.columns"
            :key="index"
            :value="index"
          >
            {{ index + 1 }} · {{ column.header }}
          </option>
        </select></label><label>{{ m.headerLast
        }}<select v-model.number="last">
          <option
            v-for="(column, index) in list.columns"
            :key="index"
            :value="index"
          >
            {{ index + 1 }} · {{ column.header }}
          </option>
        </select></label>
      <div>
        <button
          type="button"
          @click="emit('command', { action: 'add', row, first, last })"
        >
          {{ m.addHeaderRow }}
</button><button
          type="button"
          :disabled="first >= last"
          @click="emit('command', { action: 'merge', row, first, last })"
        >
          {{ m.mergeHeader }}
</button><button
          type="button"
          @click="emit('command', { action: 'split', row, first, last })"
        >
          {{ m.splitHeader }}
        </button>
      </div>
    </fieldset>
  </details>
</template>
<style scoped>
.mr-header-editor {
  border-top: 1px solid #e2e8f0;
  margin-top: 12px;
  padding-top: 10px;
  font:
    12px/1.5 system-ui,
    sans-serif;
  color: #334155;
}
.mr-header-editor summary {
  display: flex;
  justify-content: space-between;
  cursor: pointer;
  font-weight: 600;
}
.mr-header-editor summary span {
  font-size: 10px;
  font-weight: 400;
  color: #64748b;
}
.mr-header-editor fieldset {
  border: 0;
  padding: 8px 0 0;
  margin: 0;
  min-width: 0;
}
.mr-header-editor label {
  display: grid;
  grid-template-columns: 55px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  margin: 7px 0;
}
.mr-header-editor select,
.mr-header-editor button {
  min-width: 0;
  max-width: 100%;
  font: inherit;
  color: inherit;
  background: #fff;
  border: 1px solid #dbe3ec;
  border-radius: 5px;
  padding: 4px 6px;
}
.mr-header-editor fieldset > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.mr-header-editor button {
  cursor: pointer;
  font-size: 11px;
}
.mr-header-editor :disabled {
  opacity: 0.45;
  cursor: default;
}
.mr-header-editor :focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
</style>
