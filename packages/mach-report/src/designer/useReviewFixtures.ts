import { computed, ref } from "vue";
import type { ReportTemplateFixture } from "@agile-team/mach-report";
import type { TemplateReviewOptions } from "./useTemplateReview";
import { snapshotFixtureData } from "./fixture-snapshot";
import {
  TEMPLATE_REVIEW_MESSAGES,
  type TemplateReviewMessages,
} from "./review-messages";

/** Sample data is opt-in and remains in this panel's session; never persisted with drafts. */
export function useReviewFixtures(
  props: TemplateReviewOptions,
  messages: () => TemplateReviewMessages = () => TEMPLATE_REVIEW_MESSAGES,
) {
  const fixtures = ref<ReportTemplateFixture[]>([]),
    name = ref(""),
    consent = ref(false),
    failure = ref("");
  const params = ref<Record<string, string>>({});
  const suite = computed(() => [...(props.fixtures ?? []), ...fixtures.value]);
  function capture(): void {
    failure.value = "";
    try {
      if (!consent.value) throw new Error(messages().sampleConsentMissing);
      if (!name.value.trim()) throw new Error(messages().sampleNameMissing);
      if (suite.value.length >= 20) throw new Error(messages().sampleLimit);
      if (suite.value.some((item) => item.name === name.value.trim()))
        throw new Error(messages().sampleNameDuplicate);
      const datasets = snapshotFixtureData(props.datasets ?? {});
      if (
        Object.values(datasets).reduce((sum, rows) => sum + rows.length, 0) >
        1000
      )
        throw new Error(messages().sampleRowsLimit);
      fixtures.value.push({
        name: name.value.trim(),
        datasets,
        ...(Object.keys(params.value).length
          ? { params: { ...params.value } }
          : {}),
      });
      name.value = "";
      consent.value = false;
    } catch (cause) {
      failure.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  function remove(index: number): void {
    fixtures.value.splice(index, 1);
  }
  return { fixtures, name, consent, failure, params, suite, capture, remove };
}
