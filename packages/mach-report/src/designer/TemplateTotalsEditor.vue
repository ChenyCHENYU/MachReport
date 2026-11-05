<script setup lang="ts">
import type { ListComponent } from "@agile-team/mach-report";
import {
  useTemplateTotals,
  type TemplateTotalsOptions,
} from "./useTemplateTotals";
const props = defineProps<TemplateTotalsOptions>();
const emit = defineEmits<{ (event: "change", list: ListComponent): void }>();
const {
  m,
  operation,
  field,
  position,
  fields,
  targets,
  entries,
  complex,
  blocked,
  canAdd,
  scope,
  configuredCount,
  updating,
  add,
  remove,
} = useTemplateTotals(props, (list) => emit("change", list));
</script>
<template>
  <details class="mr-totals-editor mr-designer-controls" :aria-label="m.title">
    <summary>
      <span class="mr-totals-symbol" aria-hidden="true">∑</span><strong>{{ m.title }}</strong><small>{{
        configuredCount
          ? m.configured.replace("{count}", String(configuredCount))
          : m.unconfigured
      }}</small><span class="mr-totals-entry">{{ m.add }} <i aria-hidden="true">＋</i></span>
    </summary>
    <div class="mr-totals-content">
      <small>{{ m.saved }}</small>
      <p v-if="complex" role="status">{{ m.complex }}</p>
      <template v-else>
        <label>{{ m.position
          }}<select
            v-model="position"
            :aria-label="m.position"
            :disabled="blocked"
          >
            <option
              v-for="target in targets"
              :key="target.key"
              :value="target.key"
            >
              {{ target.label }}
            </option>
          </select></label>
        <div class="mr-totals-fields">
          <label>{{ m.field
            }}<select
              v-model="field"
              :aria-label="m.field"
              :disabled="blocked || !fields.length"
            >
              <option
                v-for="column in fields"
                :key="column.field"
                :value="column.field"
              >
                {{ column.header }}
              </option>
            </select></label><label>{{ m.operation
            }}<select
              v-model="operation"
              :aria-label="m.operation"
              :disabled="blocked"
            >
              <option value="sum">{{ m.sum }}</option>
              <option value="avg">{{ m.avg }}</option>
              <option value="count">{{ m.count }}</option>
            </select></label>
        </div>
        <button
          class="mr-totals-add"
          type="button"
          :disabled="!canAdd"
          @click="add"
        >
          {{ updating ? m.update : m.add }}
        </button>
        <p class="mr-totals-scope">{{ scope }}</p>
        <ul v-if="entries.length">
          <li v-for="entry in entries" :key="entry.field">
            <span><strong>{{ entry.label }}</strong><small>{{
                entry.editable
                  ? m[entry.op as "sum" | "avg" | "count"]
                  : m.advanced
              }}</small></span><button
              v-if="entry.editable"
              type="button"
              :aria-label="`${m.remove} ${entry.label}`"
              :disabled="blocked"
              @click="remove(entry.field)"
            >
              ×
            </button>
          </li>
        </ul>
        <p v-else>{{ fields.length ? m.empty : m.noFields }}</p>
      </template>
    </div>
  </details>
</template>
<style src="./designer-controls.css"></style>
<style scoped>
.mr-totals-editor {
  border: 1px solid var(--mrp-toolbar-border, #e2e8f0);
  border-radius: 8px;
  background: var(--mrp-toolbar-bg, #fff);
}
.mr-totals-editor summary {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px;
  list-style: none;
  cursor: pointer;
}
.mr-totals-editor summary::-webkit-details-marker {
  display: none;
}
.mr-totals-symbol {
  color: var(--mrp-btn-hover-fg, #2563eb);
  font-size: 17px;
}
.mr-totals-entry {
  margin-left: auto;
  color: var(--mrp-btn-hover-fg, #2563eb);
  font-size: 11px;
}
.mr-totals-entry i {
  font-style: normal;
}
.mr-totals-editor[open] .mr-totals-entry i {
  display: inline-block;
  transform: rotate(45deg);
}
.mr-totals-content {
  display: grid;
  gap: 10px;
  padding: 0 10px 12px;
}
.mr-totals-editor label,
.mr-totals-editor li > span {
  display: grid;
  gap: 5px;
}
.mr-totals-editor small,
.mr-totals-editor p {
  font-size: 11px;
  color: var(--mrp-btn-fg, #64748b);
  line-height: 1.6;
  margin: 0;
}
.mr-totals-fields {
  display: grid;
  grid-template-columns: 1fr 100px;
  gap: 8px;
}
.mr-totals-editor ul {
  display: grid;
  gap: 6px;
  padding: 0;
  margin: 0;
  list-style: none;
}
.mr-totals-editor li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px;
  border: 1px solid var(--mrp-toolbar-border, #e2e8f0);
  border-radius: 6px;
}
.mr-totals-add {
  justify-self: start;
}
</style>
