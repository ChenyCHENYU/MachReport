<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ReportTemplateReviewIssue } from "@agile-team/mach-report";
import {
  useTemplateReview,
  type TemplateReviewOptions,
} from "./useTemplateReview";
import {
  TEMPLATE_REVIEW_MESSAGES,
  type TemplateReviewMessages,
} from "./review-messages";
import { useReviewFixtures } from "./useReviewFixtures";
import TemplateFixtureComparison from "./TemplateFixtureComparison.vue";
const props = defineProps<
  TemplateReviewOptions & { messages?: Partial<TemplateReviewMessages> }
>();
const emit = defineEmits<{
  (
    event: "locate",
    value: Pick<
      ReportTemplateReviewIssue,
      "path" | "pageIndex" | "componentIndex" | "field"
    >,
  ): void;
}>();
const m = computed(() => ({ ...TEMPLATE_REVIEW_MESSAGES, ...props.messages }));
const {
  name: fixtureName,
  consent,
  failure: fixtureFailure,
  params: fixtureParams,
  suite,
  capture,
  remove,
} = useReviewFixtures(props, () => m.value);
const {
  report,
  sampleSize,
  acknowledged,
  running,
  stale,
  failure,
  checkedScope,
  checkedFixtures,
  hasTree,
  errors,
  run,
  cancel,
  cancelled,
  progress,
} = useTemplateReview(props, () => suite.value);
const comparison = ref<string>();
const comparisonFixture = computed(() =>
  checkedFixtures.value.find((fixture) => fixture.name === comparison.value),
);
watch(stale, (value) => {
  if (value) comparison.value = undefined;
});
function locate(path: string): void {
  const match = /\.pages\[(\d+)\]\.components\[(\d+)\]/.exec(path);
  emit("locate", {
    path,
    ...(match
      ? { pageIndex: Number(match[1]), componentIndex: Number(match[2]) }
      : {}),
  });
}
</script>
<template>
  <section
    class="mr-template-review"
    :aria-label="m.title"
    :aria-busy="running"
  >
    <header>
      <strong>{{ m.title }}</strong><span v-if="running && progress" role="status">{{ progress.completed }} / {{ progress.total }} {{ m.progress }}</span><button v-if="running" type="button" @click="cancel">
        {{ m.cancel }}
</button><button type="button" :disabled="running" @click="run">
        {{ running ? m.running : m.run }}
      </button>
    </header>
    <p v-if="cancelled" class="mr-review-stale" role="status">
      {{ m.cancelled }}
    </p>
    <div class="mr-review-controls">
      <label>{{ m.samples
        }}<select
          v-model="sampleSize"
          :aria-label="m.samples"
          :disabled="running || !!suite.length"
        >
          <option value="0">{{ m.none }}</option>
          <option value="20">{{ m.first20 }}</option>
          <option value="100">{{ m.first100 }}</option>
          <option value="-1">{{ m.all }}</option>
        </select></label><span v-if="suite.length" class="mr-review-note">{{ m.namedFixtures }} · {{ suite.length }}</span>
    </div>
    <details class="mr-review-fixtures">
      <summary>
        {{ m.namedFixtures }} <small>{{ suite.length }} / 20</small>
      </summary>
      <p class="mr-review-note">{{ m.fixtureHint }}</p>
      <ul v-if="suite.length">
        <li v-for="(fixture, index) in suite" :key="fixture.name">
          <strong>{{ fixture.name }}</strong><span>{{
              Object.values(fixture.datasets).reduce(
                (sum, rows) => sum + rows.length,
                0,
              )
            }}
            {{ m.rows }}</span><button
            v-if="index >= (fixtures?.length ?? 0)"
            type="button"
            :disabled="running"
            @click="remove(index - (fixtures?.length ?? 0))"
          >
            {{ m.remove }}
          </button>
        </li>
      </ul>
      <div class="mr-review-fixture-form">
        <label>{{ m.fixtureName
          }}<input
            v-model="fixtureName"
            :placeholder="m.fixturePlaceholder"
            :disabled="running"
        /></label>
        <details v-if="document.template.params?.length">
          <summary>{{ m.parameters }}</summary>
          <label v-for="param in document.template.params" :key="param.field">{{ param.label ?? param.field
            }}<input
              v-model="fixtureParams[param.field]"
              :placeholder="param.defaultValue"
              :disabled="running"
          /></label>
        </details>
        <label class="mr-review-consent"><input v-model="consent" type="checkbox" :disabled="running" />{{
            m.deidentified
          }}</label><button
          type="button"
          :disabled="
            running || !consent || !fixtureName.trim() || suite.length >= 20
          "
          @click="capture"
        >
          {{ m.capture }}
        </button>
        <p v-if="fixtureFailure" role="alert" class="is-error">
          {{ fixtureFailure }}
        </p>
      </div>
    </details>
    <p v-if="hasTree" class="mr-review-note">{{ m.treeHint }}</p>
    <p v-if="failure" class="is-error" role="alert">{{ failure }}</p>
    <p v-if="stale" class="mr-review-stale" role="status">{{ m.stale }}</p>
    <p v-if="!report" class="mr-review-note">{{ m.empty }}</p>
    <template v-else>
      <div v-if="!stale" class="mr-review-summary" role="status">
        <span :class="{ 'is-error': errors }">{{ errors }} {{ m.errors }}</span><span>{{ report.issues.length - errors }} {{ m.warnings }}</span>
      </div>
      <section>
        <h3>
          {{ m.changes }} <small>{{ report.changes?.totalChanges ?? 0 }}</small>
        </h3>
        <p v-if="!previous" class="mr-review-note">{{ m.baseline }}</p>
        <p v-else-if="!report.changes?.totalChanges" class="mr-review-note">
          {{ m.noChanges }}
        </p>
        <ol v-else class="mr-review-list">
          <li v-for="(change, index) in report.changes?.changes" :key="index">
            <div>
              <span>{{ m.categories[change.category] }} ·
                {{ m.kinds[change.kind] }}</span><b v-if="change.breaking">{{ m.breaking }}</b><button type="button" @click="locate(change.path)">
                {{ m.locate }}
              </button>
            </div>
            <code>{{ change.path }}</code>
            <dl>
              <template v-if="change.before !== undefined">
                <dt>{{ m.before }}</dt>
                <dd>{{ change.before }}</dd>
</template><template v-if="change.after !== undefined">
                <dt>{{ m.after }}</dt>
                <dd>{{ change.after }}</dd>
              </template>
            </dl>
          </li>
        </ol>
        <p v-if="report.changes?.truncated" class="mr-review-note">
          {{ m.truncated }}
        </p>
        <label v-if="report.changes?.breakingChanges" class="mr-review-ack"><input v-model="acknowledged" type="checkbox" />{{
            m.acknowledge
          }}</label>
      </section>
      <section>
        <h3>{{ m.issues }}</h3>
        <p v-if="!report.issues.length" class="mr-review-note">
          {{ m.noIssues }}
        </p>
        <ol v-else class="mr-review-list">
          <li v-for="(issue, index) in report.issues" :key="index">
            <div>
              <span :class="{ 'is-error': issue.severity === 'error' }">{{
                issue.severity === "error" ? m.errors : m.warnings
              }}</span><button type="button" @click="emit('locate', issue)">
                {{ m.locate }}
              </button>
            </div>
            <p>{{ issue.message }}</p>
            <code>{{ issue.path }}</code>
          </li>
        </ol>
      </section>
      <section v-if="report.samples.length" :class="{ 'is-stale': stale }">
        <h3>{{ m.results }}</h3>
        <p v-if="checkedScope" class="mr-review-scope">
          {{ m.scope }} ·
          {{
            suite.length
              ? m.namedFixtures
              : checkedScope.requested === "-1"
                ? m.all
                : checkedScope.requested === "0"
                  ? m.none
                  : checkedScope.requested + " " + m.rows
          }}
          · {{ checkedScope.datasets }} {{ m.datasets }} ·
          {{ checkedScope.rows }} {{ m.rows
          }}<span v-if="checkedScope.formats.length">
            · {{ checkedScope.formats.join(" / ") }}</span>
        </p>
        <div
          v-for="item in report.samples"
          :key="item.name"
          class="mr-review-sample"
        >
          <p>
            <strong>{{ item.name }}</strong> · {{ item.rows }} {{ m.rows }} ·
            {{ item.pages }} {{ m.pages }} ·
            {{
              report.issues.filter((issue) => issue.fixture === item.name)
                .length
            }}
            {{ m.issues }}
          </p>
          <button
            type="button"
            :disabled="stale || running"
            @click="
              comparison = comparison === item.name ? undefined : item.name
            "
          >
            {{ comparison === item.name ? m.closeCompare : m.compare }}
          </button>
        </div>
      </section>
      <TemplateFixtureComparison
        v-if="comparisonFixture && !stale"
        :document="document"
        :previous="previous"
        :fixture="comparisonFixture"
        :messages="messages"
      />
      <p class="mr-review-note">{{ m.checked }}</p>
    </template>
  </section>
</template>
<style scoped>
.mr-template-review {
  min-width: 0;
  padding: 16px;
  color: var(--mrp-toolbar-fg, #334155);
  font:
    12px/1.5 system-ui,
    sans-serif;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.8fr);
  gap: 14px 20px;
  align-content: start;
}
.mr-review-fixtures {
  grid-column: 1/-1;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  background: #f8fafc;
}
.mr-review-fixtures summary {
  cursor: pointer;
  font-weight: 600;
}
.mr-review-fixtures summary small {
  font-weight: 400;
  color: #64748b;
  margin-left: 8px;
}
.mr-review-fixtures ul {
  list-style: none;
  padding: 0;
}
.mr-review-fixtures li {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid #e2e8f0;
}
.mr-review-fixtures li button {
  margin-left: auto;
}
.mr-review-fixture-form {
  display: grid;
  gap: 8px;
}
.mr-review-fixture-form label {
  display: flex;
  gap: 10px;
  align-items: center;
}
.mr-review-fixture-form input:not([type="checkbox"]) {
  width: min(100%, 420px);
  min-width: 0;
  padding: 7px 9px;
  border: 1px solid #dbe3ee;
  border-radius: 6px;
  background: #fff;
  font: inherit;
}
.mr-review-fixture-form > button {
  justify-self: start;
}
.mr-review-fixture-form details label {
  margin-top: 7px;
}
.mr-review-consent {
  font-size: 11px;
  color: #64748b;
}
.mr-review-sample {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid #f1f5f9;
  padding: 5px 0;
}
.mr-review-stale {
  grid-column: 1/-1;
  margin: 0;
  padding: 9px 12px;
  color: #92400e;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
}
.is-stale {
  opacity: 0.65;
}
.mr-review-scope {
  color: #64748b;
  font-size: 11px;
}
.mr-template-review > header,
.mr-review-controls,
.mr-review-summary,
.mr-template-review > .mr-review-note {
  grid-column: 1/-1;
}
.mr-template-review header,
.mr-review-list li > div {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mr-template-review header {
  justify-content: space-between;
  min-height: 30px;
}
.mr-template-review header strong {
  font-size: 14px;
}
.mr-template-review header button {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
.mr-template-review button,
.mr-template-review select {
  min-height: 28px;
  border: 1px solid var(--mrp-toolbar-border, #e2e8f0);
  border-radius: 5px;
  background: #fff;
  color: inherit;
  font: inherit;
}
.mr-template-review button {
  padding: 3px 9px;
  cursor: pointer;
}
.mr-template-review button:disabled {
  cursor: default;
  opacity: 0.55;
}
.mr-template-review :is(button, select, input):focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
}
.mr-review-controls label {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.mr-review-controls select {
  width: min(100%, 360px);
  padding: 4px 6px;
}
.mr-review-summary {
  display: flex;
  gap: 8px;
  color: #1d4ed8;
}
.mr-review-summary > span {
  border: 1px solid #dbeafe;
  background: #eff6ff;
  border-radius: 20px;
  padding: 3px 10px;
}
.mr-review-summary > .is-error {
  border-color: #fecaca;
  background: #fef2f2;
}
.is-error {
  color: #b91c1c;
}
.mr-template-review > section {
  margin: 0;
  padding: 14px;
  border: 1px solid var(--mrp-toolbar-border, #e2e8f0);
  border-radius: 8px;
  min-width: 0;
  background: #fff;
}
.mr-template-review > section:nth-of-type(3) {
  grid-column: 1/-1;
}
.mr-template-review h3 {
  margin: 0 0 10px;
  font:
    600 12px/1.5 system-ui,
    sans-serif;
}
.mr-template-review h3 small {
  color: #64748b;
  font-weight: 400;
}
.mr-review-note {
  color: #64748b;
}
.mr-review-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.mr-review-list li {
  padding: 10px 0;
  border-bottom: 1px solid var(--mrp-toolbar-border, #e2e8f0);
}
.mr-review-list button {
  margin-left: auto;
}
.mr-review-list b {
  color: #a16207;
  font-size: 11px;
  font-weight: 500;
}
.mr-review-list code {
  display: block;
  overflow-wrap: anywhere;
  color: #64748b;
  font-size: 10px;
}
.mr-review-list dl {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 3px;
  margin: 6px 0 0;
}
.mr-review-list dt {
  color: #64748b;
}
.mr-review-list dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.mr-review-list p {
  margin: 5px 0;
}
.mr-review-ack {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  margin-top: 9px;
}
@media (max-width: 760px) {
  .mr-template-review {
    grid-template-columns: minmax(0, 1fr);
    padding: 12px;
  }
  .mr-template-review > section {
    grid-column: 1;
  }
}
</style>
