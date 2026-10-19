<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ReportExpression } from "../analytics/computed";
import { getComputationMetadata } from "../analytics/computed";
import type { AggregateOperation } from "../analytics/aggregate";
import type { RuleEditorMessages } from "./rule-messages";
const props = defineProps<{
  modelValue: ReportExpression;
  fields: readonly { field: string; label: string }[];
  messages: RuleEditorMessages;
  readonly?: boolean;
  depth?: number;
}>();
const emit = defineEmits<{
  (event: "update:modelValue", value: ReportExpression): void;
}>();
const metadata = getComputationMetadata();
const mode = computed(() =>
  "aggregate" in props.modelValue
    ? "aggregate"
    : "field" in props.modelValue
      ? "field"
      : "value" in props.modelValue
        ? "constant"
        : "operation",
);
const constantType = ref("text");
watch(
  () => props.modelValue,
  (value) => {
    if ("value" in value)
      constantType.value =
        value.value === null
          ? "null"
          : typeof value.value === "string"
            ? "text"
            : typeof value.value;
  },
  { immediate: true },
);
function update(value: ReportExpression): void {
  if (!props.readonly) emit("update:modelValue", value);
}
function setMode(value: string): void {
  if (value === "aggregate")
    update({ aggregate: "sum", field: props.fields[0]?.field ?? "" });
  else if (value === "field") update({ field: props.fields[0]?.field ?? "" });
  else if (value === "constant") update({ value: "" });
  else
    update({
      op: "add",
      args: [{ field: props.fields[0]?.field ?? "" }, { value: 0 }],
    });
}
function setOp(value: string): void {
  const op = value as Extract<ReportExpression, { op: string }>["op"];
  const args =
    "args" in props.modelValue
      ? props.modelValue.args
      : [{ value: 0 }, { value: 0 }];
  update({
    op,
    args: op === "divide" || op === "subtract" ? args.slice(0, 2) : args,
  });
}
function setArgument(index: number, value: ReportExpression): void {
  if (!("args" in props.modelValue)) return;
  update({
    ...props.modelValue,
    args: props.modelValue.args.map((item, position) =>
      position === index ? value : item,
    ),
  });
}
function alterArguments(index?: number): void {
  if (!("args" in props.modelValue)) return;
  const args =
    index === undefined
      ? [...props.modelValue.args, { value: 0 } as ReportExpression]
      : props.modelValue.args.filter((_, position) => position !== index);
  update({ ...props.modelValue, args });
}
function setConstantType(value: string): void {
  constantType.value = value;
  update({
    value:
      value === "null"
        ? null
        : value === "boolean"
          ? false
          : value === "number"
            ? 0
            : "",
  });
}
function setConstant(value: string): void {
  if (constantType.value === "number") {
    if (value.trim() && Number.isFinite(Number(value)))
      update({ value: Number(value) });
  } else update({ value });
}
function setAggregate(
  key: "field" | "weightField" | "aggregate",
  value: string,
): void {
  if (!("aggregate" in props.modelValue)) return;
  const next = { ...props.modelValue, [key]: value };
  if (key === "aggregate") next.aggregate = value as AggregateOperation;
  if (key === "field" && !value) delete next.field;
  update(next);
}
</script>

<template>
  <div
    class="mr-expression"
    :class="{ 'mr-expression--nested': (depth ?? 0) > 0 }"
  >
    <div class="mr-expression__row">
      <select
        :value="mode"
        :disabled="readonly"
        :aria-label="messages.argument"
        @change="setMode(($event.target as HTMLSelectElement).value)"
      >
        <option value="field">{{ messages.field }}</option>
        <option value="constant">{{ messages.constant }}</option>
        <option v-if="(depth ?? 0) < 12" value="operation">
          {{ messages.operation }}
        </option>
        <option value="aggregate">{{ messages.aggregate }}</option>
      </select>
      <select
        v-if="'field' in modelValue && !('aggregate' in modelValue)"
        :value="modelValue.field"
        :disabled="readonly"
        :aria-label="messages.field"
        @change="update({ field: ($event.target as HTMLSelectElement).value })"
      >
        <option v-for="item in fields" :key="item.field" :value="item.field">
          {{ item.label }}
        </option>
      </select>
      <select
        v-else-if="'op' in modelValue"
        :value="modelValue.op"
        :disabled="readonly"
        :aria-label="messages.operation"
        @change="setOp(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="op in metadata.operations" :key="op" :value="op">
          {{ messages[op] }}
        </option>
      </select>
      <select
        v-else-if="'aggregate' in modelValue"
        :value="modelValue.aggregate"
        :disabled="readonly"
        :aria-label="messages.aggregate"
        @change="
          setAggregate('aggregate', ($event.target as HTMLSelectElement).value)
        "
      >
        <option v-for="op in metadata.aggregates" :key="op" :value="op">
          {{ messages[op] }}
        </option>
      </select>
      <select
        v-else
        :value="constantType"
        :disabled="readonly"
        :aria-label="messages.resultType"
        @change="setConstantType(($event.target as HTMLSelectElement).value)"
      >
        <option value="text">{{ messages.text }}</option>
        <option value="number">{{ messages.number }}</option>
        <option value="boolean">{{ messages.boolean }}</option>
        <option value="null">{{ messages.null }}</option>
      </select>
    </div>
    <template v-if="'aggregate' in modelValue">
      <select
        :value="modelValue.field ?? ''"
        :disabled="readonly"
        :aria-label="messages.measure"
        @change="
          setAggregate('field', ($event.target as HTMLSelectElement).value)
        "
      >
        <option v-if="modelValue.aggregate === 'count'" value="">
          {{ messages.allRows }}
        </option>
        <option v-for="item in fields" :key="item.field" :value="item.field">
          {{ item.label }}
        </option>
      </select>
      <select
        v-if="modelValue.aggregate === 'weightedAvg'"
        :value="modelValue.weightField ?? ''"
        :disabled="readonly"
        :aria-label="messages.weight"
        @change="
          setAggregate(
            'weightField',
            ($event.target as HTMLSelectElement).value,
          )
        "
      >
        <option value="" disabled>{{ messages.weight }}</option>
        <option v-for="item in fields" :key="item.field" :value="item.field">
          {{ item.label }}
        </option>
      </select>
    </template>
    <template v-else-if="'value' in modelValue">
      <select
        v-if="constantType === 'boolean'"
        :value="String(modelValue.value)"
        :disabled="readonly"
        :aria-label="messages.constant"
        @change="
          update({
            value: ($event.target as HTMLSelectElement).value === 'true',
          })
        "
      >
        <option value="true">{{ messages.true }}</option>
        <option value="false">{{ messages.false }}</option>
      </select>
      <input
        v-else-if="constantType !== 'null'"
        :type="constantType === 'number' ? 'number' : 'text'"
        :value="modelValue.value ?? ''"
        :disabled="readonly"
        :aria-label="messages.constant"
        @input="setConstant(($event.target as HTMLInputElement).value)"
      />
    </template>
    <template v-else-if="'args' in modelValue">
      <div
        v-for="(argument, index) in modelValue.args"
        :key="index"
        class="mr-expression__argument"
      >
        <ReportExpressionEditor
          :model-value="argument"
          :fields="fields"
          :messages="messages"
          :readonly="readonly"
          :depth="(depth ?? 0) + 1"
          @update:model-value="setArgument(index, $event)"
        />
        <button
          v-if="modelValue.args.length > 2"
          type="button"
          :disabled="readonly"
          :aria-label="`${messages.remove} ${messages.argument} ${index + 1}`"
          @click="alterArguments(index)"
        >
          ×
        </button>
      </div>
      <button
        v-if="
          !['subtract', 'divide'].includes(modelValue.op) &&
          modelValue.args.length < 16
        "
        type="button"
        :disabled="readonly"
        @click="alterArguments()"
      >
        + {{ messages.addArgument }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.mr-expression {
  display: grid;
  gap: 6px;
  min-width: 0;
  font: inherit;
  color: inherit;
}
.mr-expression--nested {
  border-left: 2px solid var(--mr-color-border, #dce5f0);
  padding-left: 8px;
}
.mr-expression__row {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 6px;
}
.mr-expression__argument {
  display: flex;
  gap: 4px;
  align-items: flex-start;
}
.mr-expression__argument > .mr-expression {
  flex: 1;
}
select,
input,
button {
  font: inherit;
  color: inherit;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  border: 1px solid var(--mr-color-border, #dce5f0);
  border-radius: 5px;
  background: #fff;
  height: 30px;
  padding: 4px 7px;
}
select,
input {
  width: 100%;
}
button {
  cursor: pointer;
  white-space: nowrap;
}
button:disabled,
input:disabled,
select:disabled {
  opacity: 0.55;
  cursor: default;
}
:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
</style>
