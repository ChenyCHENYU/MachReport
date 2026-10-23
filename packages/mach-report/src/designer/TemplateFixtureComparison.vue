<script setup lang="ts">
import { computed } from "vue";
import { ReportPreview } from "@agile-team/mach-report/vue";
import type {
  ReportTemplateDocument,
  ReportTemplateFixture,
} from "@agile-team/mach-report";
import { compareTemplateFixture } from "./review-comparison";
import {
  TEMPLATE_REVIEW_MESSAGES,
  type TemplateReviewMessages,
} from "./review-messages";
const props = defineProps<{
  document: ReportTemplateDocument;
  previous?: ReportTemplateDocument;
  fixture: ReportTemplateFixture;
  messages?: Partial<TemplateReviewMessages>;
}>();
const m = computed(() => ({ ...TEMPLATE_REVIEW_MESSAGES, ...props.messages }));
const prepared = computed(() => {
  try {
    return {
      result: compareTemplateFixture(
        props.document,
        props.fixture,
        props.previous,
      ),
    };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
});
</script>
<template>
  <section class="mr-fixture-comparison" :aria-label="m.compare">
    <p v-if="prepared.error" role="alert">{{ prepared.error }}</p>
    <template v-if="prepared.result">
<dl>
        <dt>{{ m.pages }}</dt>
        <dd>
          {{ prepared.result.previous?.pages ?? "—" }} →
          {{ prepared.result.current.pages }}
        </dd>
        <dt>{{ m.dimensions }}</dt>
        <dd>
          {{ prepared.result.previous?.dimensions.join(" / ") ?? "—" }} →
          {{ prepared.result.current.dimensions.join(" / ") }}
        </dd>
        <dt>{{ m.fieldsAdded }}</dt>
        <dd>{{ prepared.result.addedFields.join("、") || "—" }}</dd>
        <dt>{{ m.fieldsRemoved }}</dt>
        <dd>{{ prepared.result.removedFields.join("、") || "—" }}</dd>
      </dl>
      <div class="mr-fixture-previews">
        <article v-if="prepared.result.previous">
          <h4>{{ m.baselinePreview }}</h4>
          <ReportPreview
            report-id="baseline"
            :fetcher="prepared.result.previous.fetcher"
            :show-params="false"
            :show-export="false"
            :show-print="false"
            :show-pdf-window="false"
            :editable="false"
            :excel-import="false"
            height="400px"
          />
        </article>
        <article>
          <h4>{{ m.draftPreview }}</h4>
          <ReportPreview
            report-id="draft"
            :fetcher="prepared.result.current.fetcher"
            :show-params="false"
            :show-export="false"
            :show-print="false"
            :show-pdf-window="false"
            :editable="false"
            :excel-import="false"
            height="400px"
          />
        </article>
</div>
</template>
  </section>
</template>
<style scoped>
.mr-fixture-comparison {
  grid-column: 1/-1;
}
.mr-fixture-comparison dl {
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr);
  gap: 5px;
  margin: 0 0 12px;
}
.mr-fixture-comparison dt {
  color: #64748b;
}
.mr-fixture-comparison dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.mr-fixture-previews {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
  gap: 12px;
}
.mr-fixture-previews article {
  min-width: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}
.mr-fixture-previews h4 {
  margin: 0;
  padding: 8px 12px;
  background: #f8fafc;
  font-weight: 600;
}
.mr-fixture-comparison p {
  color: #b91c1c;
}
</style>
