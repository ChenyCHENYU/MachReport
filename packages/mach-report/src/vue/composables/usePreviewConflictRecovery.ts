import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import type { RenderPlan, ReportCellEdit, ReportCellInput } from "@agile-team/mach-report";
import { cloneReportSnapshot } from "../snapshot";
import { createConflictReview, type ConflictChoice, type ConflictReviewRow } from "../edit-conflict-review";
import type { PreviewQueryCandidate } from "./usePreviewSession";

interface ConflictRecoveryHost {
  plan: Ref<RenderPlan | null>;
  busy(): boolean;
  canQuery(): boolean;
  pending(): readonly ReportCellEdit[];
  pendingRevision(): number;
  pause(): boolean;
  retain(edits: readonly ReportCellEdit[]): void;
  prepare(signal: AbortSignal): Promise<PreviewQueryCandidate>;
  apply(inputs: readonly ReportCellInput[]): Promise<boolean>;
  failure(): string | null;
  error(cause: unknown): string;
  stale(): string;
}

/** Requery and compare before using the normal validated, atomic edit transaction again. */
export function usePreviewConflictRecovery(host: ConflictRecoveryHost) {
  const opened = ref(false), reading = ref(false), applying = ref(false);
  const rows = shallowRef<readonly ConflictReviewRow[]>([]);
  const error = ref<string | null>(null);
  const ready = computed(() => !!candidate.value && rows.value.every(row => row.choice !== null));
  const candidate = shallowRef<PreviewQueryCandidate | null>(null);
  let controller: AbortController | null = null;
  let generation = 0, publishing = false;
  let reviewedRevision = -1;
  function invalidate(): void { generation++; controller?.abort(); controller = null; candidate.value = null; reading.value = false; }
  function close(): void {
    if (applying.value) return;
    invalidate(); opened.value = false; rows.value = []; error.value = null;
  }
  async function refresh(): Promise<void> {
    if (host.busy() || applying.value || !opened.value) return;
    invalidate(); rows.value = []; error.value = null;
    const sequence = generation, current = new AbortController(); controller = current; reading.value = true;
    try {
      const revision = host.pendingRevision();
      const intentions = cloneReportSnapshot(host.pending());
      const next = await host.prepare(current.signal);
      if (sequence !== generation || current.signal.aborted) return;
      if (revision !== host.pendingRevision()) { error.value = host.stale(); return; }
      rows.value = createConflictReview(next.plan, intentions);
      reviewedRevision = revision;
      candidate.value = next;
    } catch (cause) { if (sequence === generation && !current.signal.aborted) error.value = host.error(cause); }
    finally { if (sequence === generation) { reading.value = false; controller = null; } }
  }
  async function open(): Promise<void> {
    if (host.busy() || !host.pending().length || !host.pause() || !host.pending().length) return;
    opened.value = true;
    if (host.canQuery()) await refresh();
  }
  function choose(key: string, choice: ConflictChoice): void {
    if (reading.value || applying.value) return;
    rows.value = rows.value.map(row => row.key === key && (choice === "server" || row.availability === "available") ? { ...row, choice } : row);
  }
  async function submit(): Promise<boolean> {
    if (!ready.value || host.busy() || reading.value || applying.value || !candidate.value) return false;
    if (reviewedRevision !== host.pendingRevision()) { candidate.value = null; error.value = host.stale(); return false; }
    const next = candidate.value, chosen = rows.value.filter(row => row.choice === "local");
    const intentions = chosen.map(row => row.edit);
    const inputs = chosen.map(row => ({ address: row.address!, value: row.edit.value }));
    applying.value = true; error.value = null;
    try {
      publishing = true;
      const accepted = next.accept(() => host.retain(intentions));
      publishing = false; candidate.value = null;
      if (!accepted) { error.value = host.stale(); return false; }
      if (!inputs.length) { opened.value = false; rows.value = []; return true; }
      const success = await host.apply(inputs);
      if (success) { opened.value = false; rows.value = []; }
      else error.value = host.failure();
      return success;
    } catch (cause) { host.retain(intentions); error.value = host.error(cause); return false; }
    finally { publishing = false; applying.value = false; }
  }
  watch(host.plan, () => {
    if (publishing || applying.value) return;
    close();
  }, { flush: "sync" });
  onScopeDispose(() => { invalidate(); opened.value = false; rows.value = []; });
  return { opened, reading, applying, rows, error, ready, open, close, refresh, choose, submit };
}
