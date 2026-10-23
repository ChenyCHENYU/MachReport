import type { ReportDrillAction, ReportDrillRequest } from "../source/drill";
/** Trusted host-owned allowlist. Matching serialized metadata alone never executes an action. */
export interface ReportDrillOptions {
  actions: readonly ReportDrillAction[];
  open(request: ReportDrillRequest & { signal: AbortSignal; view: Readonly<{ zoom: number; scrollTop: number; scrollLeft: number }> }): void | Promise<void>;
}
