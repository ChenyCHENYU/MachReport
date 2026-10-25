import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, shallowRef } from "vue";
import { mount } from "@vue/test-utils";
import { useReportDataReview } from "../composables/useReportDataReview";
import type { ReportDataReviewSource } from "../data-review";
import type { RenderPlan } from "../../schema/render-plan";
describe("immutable review plan watches", () => {
  it("never traverses published report cells while mounting or replacing plans, including disabled tools", () => {
    const readPages = vi.fn(() => []);
    function plan(): RenderPlan { return { schemaVersion: "test", get pages() { return readPages(); } }; }
    const current = shallowRef<RenderPlan | null>(plan());
    const options = shallowRef<ReportDataReviewSource | false>(false);
    const wrapper = mount(defineComponent({ setup() {
      useReportDataReview({ plan: current, options, blocked: () => false }, () => 0);
      useReportDataReview({ plan: current, options, blocked: () => false }, () => 0);
      return () => h("div");
    } }));
    expect(readPages).not.toHaveBeenCalled();
    current.value = plan(); expect(readPages).not.toHaveBeenCalled();
    options.value = { datasetId: "detail", load: () => [] };
    expect(readPages).not.toHaveBeenCalled();
    current.value = plan(); expect(readPages).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
