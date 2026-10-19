<script setup lang="ts">
import { getComputationMetadata } from "../processing/computed";
import {
  useRuleDataLayout,
  type RuleDataLayoutOptions,
} from "./useRuleDataLayout";
import type { ListComponent } from "../layout/paginate";
const props = defineProps<RuleDataLayoutOptions>();
const emit = defineEmits<{ (event: "change", list: ListComponent): void }>();
const editor = useRuleDataLayout(props, (list) => emit("change", list));
const {
  enabled,
  detail,
  matrix,
  datasets,
  sourceFields,
  childFields,
  error,
  preview,
} = editor;
const metadata = getComputationMetadata();
</script>
<template>
  <div class="mr-data-layout">
    <label class="mr-data-layout__check"><input v-model="enabled" type="checkbox" :disabled="readonly" />{{
        messages.enabled
      }}{{ mode === "detail" ? messages.detail : messages.matrix }}</label>
    <template v-if="enabled && mode === 'detail'">
      <p class="mr-data-layout__hint">{{ messages.detailHint }}</p>
      <label>{{ messages.childDataset
        }}<select
:aria-label="messages.childDataset"
          :value="detail.dataset"
          :disabled="readonly"
          @change="
            editor.chooseDataset(($event.target as HTMLSelectElement).value)
          "
        >
          <option value="" disabled>{{ messages.select }}</option>
          <option v-for="dataset in datasets" :key="dataset" :value="dataset">
            {{ dataset }}
          </option>
        </select></label>
      <div class="mr-data-layout__pair">
        <label>{{ messages.parentKey
          }}<select :aria-label="messages.parentKey" v-model="detail.parentKey" :disabled="readonly">
            <option
              v-for="field in sourceFields"
              :key="field.field"
              :value="field.field"
            >
              {{ field.label }}
            </option>
          </select></label><label>{{ messages.foreignKey
          }}<select :aria-label="messages.foreignKey" v-model="detail.foreignKey" :disabled="readonly">
            <option value="" disabled>{{ messages.select }}</option>
            <option
              v-for="field in childFields"
              :key="field.field"
              :value="field.field"
            >
              {{ field.label }}
            </option>
          </select></label>
      </div>
      <label>{{ messages.rowKey
        }}<select :aria-label="messages.rowKey" v-model="detail.rowKey" :disabled="readonly">
          <option :value="undefined">{{ messages.noRowKey }}</option>
          <option
            v-for="field in childFields"
            :key="field.field"
            :value="field.field"
          >
            {{ field.label }}
          </option>
        </select></label>
      <fieldset class="mr-data-layout__choices">
        <legend>{{ messages.childColumns }}</legend>
        <label v-for="field in childFields" :key="field.field"><input
            type="checkbox"
            :checked="
              detail.columns.some((column) => column.field === field.field)
            "
            :disabled="readonly"
            @change="
              editor.toggleChildColumn(
                field.field,
                ($event.target as HTMLInputElement).checked,
              )
            "
          />{{ field.label }}</label>
      </fieldset>
      <label>{{ messages.title }}<input :aria-label="messages.title" v-model="detail.label" :disabled="readonly" /></label>
      <div class="mr-data-layout__pair">
        <label>{{ messages.unmatched
          }}<select :aria-label="messages.unmatched" v-model="detail.unmatched" :disabled="readonly">
            <option value="error">{{ messages.error }}</option>
            <option value="ignore">{{ messages.ignore }}</option>
          </select></label><label class="mr-data-layout__check"><input
            v-model="detail.header"
            type="checkbox"
            :disabled="readonly"
          />{{ messages.childHeader }}</label>
      </div>
    </template>
    <template v-else-if="enabled">
      <p class="mr-data-layout__hint">{{ messages.matrixHint }}</p>
      <fieldset
        v-for="axis in ['rowFields', 'columnFields'] as const"
        :key="axis"
        class="mr-data-layout__choices"
      >
        <legend>{{ messages[axis] }}</legend>
        <label v-for="field in sourceFields" :key="field.field"><input
            type="checkbox"
            :checked="matrix[axis].includes(field.field)"
            :disabled="readonly"
            @change="
              editor.toggleDimension(
                axis,
                field.field,
                ($event.target as HTMLInputElement).checked,
              )
            "
          />{{ field.label }}</label>
      </fieldset>
      <div
        v-for="(measure, index) in matrix.measures"
        :key="index"
        class="mr-data-layout__measure"
      >
        <div class="mr-data-layout__pair">
          <label>{{ messages.measure
            }}<select :aria-label="messages.measure" v-model="measure.field" :disabled="readonly">
              <option
                v-for="field in sourceFields"
                :key="field.field"
                :value="field.field"
              >
                {{ field.label }}
              </option>
            </select></label><label>{{ messages.aggregate
            }}<select :aria-label="messages.aggregate" v-model="measure.op" :disabled="readonly">
              <option v-for="op in metadata.aggregates" :key="op" :value="op">
                {{ messages[op] }}
              </option>
            </select></label>
        </div>
        <label>{{ messages.measureLabel
          }}<input
:aria-label="messages.measureLabel"
            v-model="measure.label"
            :disabled="readonly"
            :placeholder="measure.field"
        /></label>
        <label v-if="measure.op === 'weightedAvg'">{{ messages.weight
          }}<select :aria-label="messages.weight" v-model="measure.weightField" :disabled="readonly">
            <option
              v-for="field in sourceFields"
              :key="field.field"
              :value="field.field"
            >
              {{ field.label }}
            </option>
          </select></label>
        <div class="mr-data-layout__pair">
          <label>{{ messages.numeric
            }}<select :aria-label="messages.numeric" v-model="measure.numeric" :disabled="readonly">
              <option value="number">{{ messages.number }}</option>
              <option value="decimal">{{ messages.decimal }}</option>
            </select></label><label>{{ messages.digits
            }}<input
:aria-label="messages.digits"
              v-model.number="measure.digits"
              type="number"
              min="0"
              max="100"
              :disabled="readonly"
          /></label>
        </div>
        <button
          type="button"
          :disabled="readonly"
          @click="editor.removeMeasure(index)"
        >
          {{ messages.remove }}
        </button>
      </div>
      <button
        type="button"
        :disabled="readonly || matrix.measures.length >= 32"
        @click="editor.addMeasure"
      >
        + {{ messages.addAggregate }}
      </button>
      <label class="mr-data-layout__check"><input
          v-model="matrix.totals"
          type="checkbox"
          :disabled="readonly"
        />{{ messages.totals }}</label>
      <details>
        <summary>{{ messages.widthSettings }}</summary>
        <div class="mr-data-layout__pair">
          <label>{{ messages.dimensionWidth
            }}<input
              v-model.number="matrix.rowWidthMm"
              type="number"
              min="1"
              :disabled="readonly"
              placeholder="40"
/></label><label>{{ messages.measureWidth
            }}<input
              v-model.number="matrix.columnWidthMm"
              type="number"
              min="1"
              :disabled="readonly"
              placeholder="28"
          /></label>
        </div>
      </details>
    </template>
    <div class="mr-data-layout__actions">
      <button
        v-if="enabled && mode === 'matrix'"
        type="button"
        :disabled="readonly"
        @click="editor.checkMatrix"
      >
        {{ messages.check }}
</button><button
        type="button"
        class="mr-data-layout__primary"
        :disabled="readonly"
        @click="editor.apply"
      >
        {{ messages.apply }}
      </button>
    </div>
    <div v-if="preview" class="mr-data-layout__preview">
      <p>{{ messages.sample }}</p>
      <table>
        <thead>
          <tr>
            <th v-for="(column, index) in preview.columns" :key="index">
              {{ column }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in preview.rows" :key="index">
            <td v-for="(cell, position) in row" :key="position">
              {{ cell ?? "—" }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="error" class="mr-data-layout__error" role="alert">{{ error }}</p>
  </div>
</template>
<style scoped>
.mr-data-layout {
  display: grid;
  gap: 12px;
  font: inherit;
  color: inherit;
  min-width: 0;
}
.mr-data-layout label {
  display: grid;
  gap: 5px;
  min-width: 0;
  font-size: 12px;
  color: #475569;
}
.mr-data-layout select,
.mr-data-layout input,
.mr-data-layout button {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  border: 1px solid #dce5f0;
  background: #fff;
  font: inherit;
  color: inherit;
  border-radius: 5px;
  padding: 5px 7px;
  height: 31px;
}
.mr-data-layout select,
.mr-data-layout input {
  width: 100%;
}
.mr-data-layout button {
  cursor: pointer;
  font-size: 12px;
}
.mr-data-layout :disabled {
  opacity: 0.5;
  cursor: default;
}
.mr-data-layout :focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
.mr-data-layout__pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}
.mr-data-layout label.mr-data-layout__check,
.mr-data-layout__choices label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mr-data-layout input[type="checkbox"] {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: #2563eb;
}
.mr-data-layout__choices {
  display: flex;
  flex-wrap: wrap;
  gap: 7px 12px;
  margin: 0;
  padding: 8px;
  border: 1px solid #e4ebf4;
  border-radius: 6px;
  max-height: 150px;
  overflow: auto;
}
.mr-data-layout__choices legend {
  font-size: 12px;
  color: #64748b;
  padding: 0 4px;
}
.mr-data-layout__measure {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid #e4ebf4;
  border-radius: 6px;
}
.mr-data-layout__hint,
.mr-data-layout__preview p {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: #64748b;
}
.mr-data-layout__actions {
  display: flex;
  gap: 6px;
}
.mr-data-layout button.mr-data-layout__primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
.mr-data-layout__error {
  font-size: 12px;
  line-height: 1.6;
  padding: 8px;
  background: #fff1f2;
  color: #be123c;
  border-radius: 6px;
  margin: 0;
}
.mr-data-layout summary {
  font-size: 12px;
  color: #64748b;
  cursor: pointer;
  margin-bottom: 8px;
}
.mr-data-layout__preview {
  overflow: auto;
  max-width: 100%;
}
.mr-data-layout__preview table {
  border-collapse: collapse;
  font-size: 11px;
  white-space: nowrap;
  margin-top: 6px;
}
.mr-data-layout__preview th,
.mr-data-layout__preview td {
  padding: 5px 7px;
  text-align: left;
  border: 1px solid #e4ebf4;
}
.mr-data-layout__preview th {
  background: #f1f6fd;
  color: #335079;
  font-weight: 500;
}
</style>
