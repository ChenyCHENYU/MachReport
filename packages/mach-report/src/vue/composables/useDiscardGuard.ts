import { shallowRef } from "vue";
import type { ReportBeforeDiscard, ReportBeforeDiscardContext, ReportDiscardReason } from "../guards";

/** A replacement decision belongs to its invocation; late decisions never approve a newer one. */
export function useDiscardGuard(host: {
  pending(): boolean;
  reportIds(): readonly string[];
  hook(): ReportBeforeDiscard | undefined;
  enabled(): boolean;
  error(cause: unknown): void;
  /** Small identity snapshot, never a deep copy of the report. */
  snapshot?(): readonly unknown[];
}) {
  const request = shallowRef<Readonly<ReportBeforeDiscardContext> | null>(null);
  const pending = shallowRef(false);
  let revision = 0;
  let resolveRequest: ((value: boolean) => void) | null = null;

  function settle(value: boolean): void {
    const resolve = resolveRequest;
    resolveRequest = null;
    request.value = null;
    pending.value = false;
    resolve?.(value);
  }
  function cancel(): void { revision++; settle(false); }
  async function check(reason: ReportDiscardReason): Promise<boolean> {
    cancel();
    if (!host.enabled() || !host.pending()) return true;
    const current = revision;
    const snapshot = [...host.snapshot?.() ?? []];
    pending.value = true;
    const context = Object.freeze({ reason, reportIds: Object.freeze([...host.reportIds()]), pendingLocalChanges: true as const });
    try {
      const hook = host.hook();
      const approved = await new Promise<boolean>((resolve) => {
        resolveRequest = resolve;
        if (!hook) { request.value = context; return; }
        Promise.resolve().then(() => hook(context)).then((value) => {
          if (current === revision) settle(value === true);
        }, (cause: unknown) => {
          if (current !== revision) return;
          try { host.error(cause); } catch { /* Error observers do not own guard decisions. */ }
          settle(false);
        });
      });
      const next = host.snapshot?.() ?? [];
      return current === revision && approved === true && next.length === snapshot.length && snapshot.every((item, index) => Object.is(item, next[index]));
    } catch (cause) {
      if (current === revision) {
        try { host.error(cause); } catch { /* Isolate host observers. */ }
        settle(false);
      }
      return false;
    }
  }
  return { request, pending, check, settle, cancel };
}
