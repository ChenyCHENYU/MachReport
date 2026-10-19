<script setup lang="ts">
import {
  getComputationMetadata,
  type ReportExpression,
} from "../analytics/computed";
import RuleDataLayout from "./RuleDataLayout.vue";
import ReportExpressionEditor from "./ReportExpressionEditor.vue";
import { useRuleEditor, type RuleEditorOptions } from "./useRuleEditor";
import type { ListComponent } from "../layout/paginate";
const props = defineProps<RuleEditorOptions>();
const emit = defineEmits<{ (event: "change", value: ListComponent): void }>();
const editor = useRuleEditor(props, (value) => emit("change", value));
const {
  m,
  tab,
  fields,
  formula,
  groups,
  groupIndex,
  currentGroup,
  column,
  currentColumn,
  conditionIndex,
  effect,
  when,
  style,
  error,
  preview,
  diagnostics,
  selectedComputed,
} = editor;
const metadata = getComputationMetadata();
</script>

<template>
  <section class="mr-rule-editor" :aria-label="m.settings">
    <div class="mr-rule-editor__tabs" role="tablist" :aria-label="m.settings">
      <button
        v-for="item in [
          'computations',
          'groups',
          'conditions',
          'detail',
          'matrix',
        ] as const"
        :key="item"
        type="button"
        role="tab"
        :aria-selected="tab === item"
        :class="{ 'is-active': tab === item }"
        @click="tab = item"
      >
        {{ m[item]
        }}<span v-if="item === 'computations' && list.computed?.length">{{
          list.computed.length
        }}</span><span v-if="item === 'groups' && groups.length">{{
          groups.length
        }}</span>
      </button>
    </div>
    <div v-if="tab === 'computations'" class="mr-rule-editor__panel">
      <label>{{ m.existing
        }}<select
:aria-label="m.existing"
          :value="selectedComputed"
          :disabled="readonly"
          @change="
            editor.loadComputed(($event.target as HTMLSelectElement).value)
          "
        >
          <option value="">+ {{ m.newField }}</option>
          <option
            v-for="item in list.computed"
            :key="item.field"
            :value="item.field"
          >
            {{ item.field }}
          </option>
        </select></label>
      <label>{{ m.target
        }}<input
:aria-label="m.target"
          v-model="formula.field"
          :disabled="readonly"
          autocomplete="off"
      /></label>
      <div class="mr-rule-editor__pair">
        <label>{{ m.scope
          }}<select :aria-label="m.scope" v-model="formula.scope" :disabled="readonly">
            <option
              v-for="scope in metadata.scopes"
              :key="scope"
              :value="scope"
            >
              {{ m[scope] }}
            </option>
          </select></label><label>{{ m.numeric
          }}<select :aria-label="m.numeric" v-model="formula.numeric" :disabled="readonly">
            <option value="number">{{ m.number }}</option>
            <option value="decimal">{{ m.decimal }}</option>
          </select></label>
      </div>
      <fieldset v-if="formula.scope === 'group'" class="mr-rule-editor__checks">
        <legend>{{ m.groupFields }}</legend>
        <label v-for="field in fields" :key="field.field"><input
            type="checkbox"
            :checked="formula.groupBy?.includes(field.field)"
            :disabled="readonly"
            @change="
              editor.toggleGroupField(
                field.field,
                ($event.target as HTMLInputElement).checked,
              )
            "
          />{{ field.label }}</label>
      </fieldset>
      <ReportExpressionEditor
        v-if="typeof formula.expression !== 'string'"
        :model-value="formula.expression as ReportExpression"
        :fields="fields"
        :messages="m"
        :readonly="readonly"
        @update:model-value="editor.setExpression"
      />
      <p v-else class="mr-rule-editor__hint">{{ formula.expression }}</p>
      <details>
        <summary>{{ m.advanced }}</summary>
        <div class="mr-rule-editor__advanced">
          <label>{{ m.digits
            }}<input
:aria-label="m.digits"
              v-model.number="formula.digits"
              type="number"
              min="0"
              max="100"
              :disabled="readonly"
/></label><label>{{ m.nulls
            }}<select :aria-label="m.nulls" v-model="formula.nulls" :disabled="readonly">
              <option value="propagate">{{ m.propagate }}</option>
              <option value="error">{{ m.error }}</option>
            </select></label><label>{{ m.division
            }}<select :aria-label="m.division" v-model="formula.divisionByZero" :disabled="readonly">
              <option value="error">{{ m.error }}</option>
              <option value="null">{{ m.propagate }}</option>
            </select></label>
        </div>
      </details>
      <p v-if="formula.numeric === 'decimal'" class="mr-rule-editor__hint">
        {{ m.decimalHint }}
      </p>
      <div
        v-if="diagnostics.valid && formula.field"
        class="mr-rule-editor__diagnostic"
      >
        {{ m.dependencies }}<strong>{{ diagnostics.order.join(" → ") }}</strong>
      </div>
      <div class="mr-rule-editor__actions">
        <button type="button" :disabled="readonly" @click="editor.check">
          {{ m.check }}
</button><button
          type="button"
          class="mr-rule-editor__primary"
          :disabled="readonly || !diagnostics.valid"
          @click="editor.applyComputed"
        >
          {{ m.apply }}
</button><button
          v-if="selectedComputed"
          type="button"
          :disabled="readonly"
          @click="editor.removeComputed"
        >
          {{ m.remove }}
        </button>
      </div>
      <div v-if="preview.length" class="mr-rule-editor__results">
        <p>{{ m.sample }}</p>
        <dl>
          <template v-for="item in preview" :key="item.row">
<dt>{{ item.row }}</dt>
            <dd>{{ item.value ?? "—" }}</dd>
</template>
        </dl>
      </div>
      <p
        v-if="!diagnostics.valid && formula.field"
        class="mr-rule-editor__error"
      >
        {{ diagnostics.errors.join("；") }}
      </p>
    </div>
    <div v-else-if="tab === 'groups'" class="mr-rule-editor__panel">
      <div class="mr-rule-editor__pair">
        <select v-model.number="groupIndex" :aria-label="m.groups">
          <option v-for="(group, index) in groups" :key="index" :value="index">
            {{ index + 1 }} · {{ group.field }}
          </option>
          <option v-if="!groups.length" :value="0">
            {{ m.noGroups }}
          </option>
</select><button
          type="button"
          :disabled="readonly || groups.length >= 16"
          @click="editor.addGroup"
        >
          + {{ m.addGroup }}
        </button>
      </div>
      <template v-if="currentGroup">
        <label>{{ m.field
          }}<select :aria-label="m.field" v-model="currentGroup.field" :disabled="readonly">
            <option
              v-for="field in fields"
              :key="field.field"
              :value="field.field"
            >
              {{ field.label }}
            </option>
          </select></label>
        <div class="mr-rule-editor__pair">
          <label>{{ m.header
            }}<input
:aria-label="m.header"
              v-model="currentGroup.headerTemplate"
              :disabled="readonly"
              placeholder="{value}"
/></label><label>{{ m.footer
            }}<input :aria-label="m.footer" v-model="currentGroup.subtotalLabel" :disabled="readonly" /></label>
        </div>
        <div class="mr-rule-editor__checks">
          <label><input
              v-model="currentGroup.keepWithNext"
              type="checkbox"
              :disabled="readonly"
            />{{ m.orphan }}</label><label><input
              v-model="currentGroup.repeatHeader"
              type="checkbox"
              :disabled="readonly"
            />{{ m.repeat }}</label>
        </div>
        <div
          v-for="(aggregate, index) in currentGroup.aggregates"
          :key="index"
          class="mr-rule-editor__aggregate"
        >
          <div class="mr-rule-editor__pair">
            <label>{{ m.output
              }}<select :aria-label="m.output" v-model="aggregate.field" :disabled="readonly">
                <option
                  v-for="field in fields"
                  :key="field.field"
                  :value="field.field"
                >
                  {{ field.label }}
                </option>
              </select></label><label>{{ m.aggregate
              }}<select :aria-label="m.aggregate" v-model="aggregate.op" :disabled="readonly">
                <option v-for="op in metadata.aggregates" :key="op" :value="op">
                  {{ m[op] }}
                </option>
              </select></label>
          </div>
          <label>{{ m.measure
            }}<select :aria-label="m.measure" v-model="aggregate.valueField" :disabled="readonly">
              <option :value="undefined">{{ aggregate.field }}</option>
              <option
                v-for="field in fields"
                :key="field.field"
                :value="field.field"
              >
                {{ field.label }}
              </option>
            </select></label>
          <label v-if="aggregate.op === 'weightedAvg'">{{ m.weight
            }}<select :aria-label="m.weight" v-model="aggregate.weightField" :disabled="readonly">
              <option
                v-for="field in fields"
                :key="field.field"
                :value="field.field"
              >
                {{ field.label }}
              </option>
            </select></label>
          <div class="mr-rule-editor__pair">
            <select
              v-model="aggregate.numeric"
              :disabled="readonly"
              :aria-label="m.numeric"
            >
              <option value="number">{{ m.number }}</option>
              <option value="decimal">{{ m.decimal }}</option>
</select><button
              type="button"
              :disabled="readonly"
              @click="currentGroup.aggregates?.splice(index, 1)"
            >
              {{ m.remove }}
            </button>
          </div>
        </div>
        <button type="button" :disabled="readonly" @click="editor.addAggregate">
          + {{ m.addAggregate }}
        </button>
        <div class="mr-rule-editor__actions">
          <button
            type="button"
            :disabled="readonly || groupIndex === 0"
            :aria-label="m.moveUp"
            @click="editor.moveGroup(-1)"
          >
            ↑ {{ m.outer }}
</button><button
            type="button"
            :disabled="readonly || groupIndex >= groups.length - 1"
            :aria-label="m.moveDown"
            @click="editor.moveGroup(1)"
          >
            ↓ {{ m.inner }}
</button><button
            type="button"
            :disabled="readonly"
            @click="editor.removeGroup"
          >
            {{ m.remove }}
          </button>
        </div>
      </template>
      <button
        type="button"
        class="mr-rule-editor__primary"
        :disabled="readonly"
        @click="editor.applyGroups"
      >
        {{ m.apply }}
      </button>
    </div>
    <div v-else-if="tab === 'conditions'" class="mr-rule-editor__panel">
      <label>{{ m.column
        }}<select
:aria-label="m.column"
          v-model="column"
          :disabled="readonly"
          @change="editor.loadCondition(-1)"
        >
          <option
            v-for="item in list.columns"
            :key="item.field"
            :value="item.field"
          >
            {{ item.header || item.field }}
          </option>
        </select></label>
      <label>{{ m.effect
        }}<select
:aria-label="m.effect"
          v-model="effect"
          :disabled="readonly"
          @change="editor.loadCondition(-1)"
        >
          <option value="style">{{ m.style }}</option>
          <option value="cell">{{ m.cell }}</option>
          <option value="rowVisibility">{{ m.rowVisibility }}</option>
        </select></label>
      <label v-if="effect === 'style'">{{ m.existing
        }}<select
:aria-label="m.existing"
          :value="conditionIndex"
          :disabled="readonly"
          @change="
            editor.loadCondition(
              Number(($event.target as HTMLSelectElement).value),
            )
          "
        >
          <option :value="-1">+ {{ m.newCondition }}</option>
          <option
            v-for="(item, index) in currentColumn?.rules"
            :key="index"
            :value="index"
          >
            {{ index + 1 }} · {{ item.when.field }} {{ item.when.op }}
            {{ item.when.value }}
          </option>
        </select></label>
      <label>{{ m.condition
        }}<select :aria-label="m.condition" v-model="when.field" :disabled="readonly">
          <option v-for="item in fields" :key="item.field" :value="item.field">
            {{ item.label }}
          </option>
        </select></label>
      <div class="mr-rule-editor__pair">
        <label>{{ m.comparison
          }}<select :aria-label="m.comparison" v-model="when.op" :disabled="readonly">
            <option
              v-for="op in ['>', '>=', '<', '<=', '==', '!=']"
              :key="op"
              :value="op"
            >
              {{ op }}
            </option>
          </select></label><label>{{ m.threshold
          }}<input
            :value="when.value"
            :disabled="readonly"
            @input="
              editor.setThreshold(($event.target as HTMLInputElement).value)
            "
        /></label>
      </div>
      <template v-if="effect === 'style'">
<div class="mr-rule-editor__pair">
          <label>{{ m.color
            }}<input
              v-model="style.color"
              type="color"
              :disabled="readonly"
/></label><label>{{ m.background
            }}<input
              v-model="style.backgroundColor"
              type="color"
              :disabled="readonly"
          /></label>
        </div>
        <label class="mr-rule-editor__check"><input v-model="style.bold" type="checkbox" :disabled="readonly" />{{
            m.bold
          }}</label>
</template>
      <div class="mr-rule-editor__actions">
        <button
          type="button"
          class="mr-rule-editor__primary"
          :disabled="readonly"
          @click="editor.applyCondition()"
        >
          {{ m.apply }}
</button><button
          v-if="conditionIndex >= 0 || effect !== 'style'"
          type="button"
          :disabled="readonly"
          @click="editor.applyCondition(true)"
        >
          {{ m.removeCondition }}
        </button>
      </div>
    </div>
    <RuleDataLayout
      v-else
      :list="list"
      :mode="tab === 'detail' ? 'detail' : 'matrix'"
      :datasets="datasets"
      :dataset-schema="datasetSchema"
      :dataset-schemas="datasetSchemas"
      :readonly="readonly"
      :messages="m"
      @change="editor.applyLayout"
    />
    <p v-if="error" class="mr-rule-editor__error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.mr-rule-editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 12px;
  font: inherit;
  color: inherit;
}
.mr-rule-editor__tabs {
  display: flex;
  background: #f4f7fb;
  padding: 3px;
  border-radius: 7px;
  gap: 3px;
}
.mr-rule-editor__tabs button {
  flex: 1;
  border-color: transparent;
  background: transparent;
  font-weight: 500;
}
.mr-rule-editor__tabs button.is-active {
  background: #fff;
  color: #1d4ed8;
  box-shadow: 0 1px 3px #0f172a12;
}
.mr-rule-editor__tabs span {
  font-size: 11px;
  margin-left: 4px;
  opacity: 0.6;
}
.mr-rule-editor__panel {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.mr-rule-editor label {
  display: grid;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  color: #475569;
  min-width: 0;
}
.mr-rule-editor select,
.mr-rule-editor input,
.mr-rule-editor button {
  font: inherit;
  color: inherit;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  border: 1px solid #dce5f0;
  border-radius: 5px;
  background: #fff;
  height: 31px;
  padding: 5px 8px;
}
.mr-rule-editor select,
.mr-rule-editor input {
  width: 100%;
  font-weight: 400;
  color: #172b4d;
}
.mr-rule-editor button {
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.mr-rule-editor :disabled {
  opacity: 0.5;
  cursor: default;
}
.mr-rule-editor :focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
.mr-rule-editor__pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}
.mr-rule-editor__checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  border: 0;
  padding: 0;
  margin: 0;
}
.mr-rule-editor__checks legend {
  font-size: 12px;
  margin-bottom: 6px;
  color: #64748b;
}
.mr-rule-editor__checks label,
.mr-rule-editor__check {
  display: flex !important;
  align-items: center;
  gap: 6px !important;
}
.mr-rule-editor input[type="checkbox"] {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: #2563eb;
}
.mr-rule-editor input[type="color"] {
  padding: 3px;
}
.mr-rule-editor__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mr-rule-editor .mr-rule-editor__primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
.mr-rule-editor summary {
  font-size: 12px;
  color: #64748b;
  cursor: pointer;
}
.mr-rule-editor__advanced {
  display: grid;
  gap: 8px;
  padding-top: 10px;
}
.mr-rule-editor__hint,
.mr-rule-editor__results p {
  font-size: 11px;
  line-height: 1.6;
  color: #64748b;
  margin: 0;
}
.mr-rule-editor__diagnostic {
  display: grid;
  gap: 4px;
  background: #f1f6fd;
  border-radius: 6px;
  padding: 9px;
  font-size: 11px;
  color: #64748b;
}
.mr-rule-editor__diagnostic strong {
  color: #1e40af;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.mr-rule-editor__error {
  margin: 0;
  padding: 9px;
  border-radius: 6px;
  background: #fff1f2;
  color: #be123c;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.mr-rule-editor__aggregate {
  display: grid;
  gap: 8px;
  border: 1px solid #e4ebf4;
  border-radius: 7px;
  padding: 10px;
}
.mr-rule-editor__results {
  border: 1px solid #dce5f0;
  border-radius: 6px;
  padding: 8px;
}
.mr-rule-editor__results dl {
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 0;
  margin: 6px 0 0;
  font-size: 12px;
}
.mr-rule-editor__results dt,
.mr-rule-editor__results dd {
  padding: 5px 0;
  margin: 0;
  border-top: 1px solid #eef2f7;
  overflow-wrap: anywhere;
}
.mr-rule-editor__results dt {
  color: #94a3b8;
}
</style>
