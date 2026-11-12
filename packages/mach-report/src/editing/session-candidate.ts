import type { RenderPlan } from "../schema/render-plan";
import { capturePlanGuard, snapshotCandidatePlan } from "./session-snapshot";
import { ReportCellEditError } from "./value";

/** Built-in candidates stay private until previewed. Custom rebuild callbacks
 * already hold their result, so their fence must be established immediately. */
export function protectSessionCandidate(plan: RenderPlan, owned: boolean) {
  const privateUnchanged = owned ? undefined : capturePlanGuard(plan);
  let preview: RenderPlan | undefined, previewUnchanged: (() => boolean) | undefined;
  function assertUnchanged(): void {
    if (privateUnchanged && !privateUnchanged() || previewUnchanged && !previewUnchanged()) throw new ReportCellEditError("conflict");
  }
  return {
    get plan(): RenderPlan {
      if (!preview) {
        assertUnchanged();
        const copy = snapshotCandidatePlan(plan), unchanged = capturePlanGuard(copy);
        preview = copy; previewUnchanged = unchanged;
      }
      return preview;
    },
    assertUnchanged
  };
}
