import { computed, getCurrentScope, onScopeDispose, ref, shallowRef } from "vue";
import type { ComputedRef, Ref, ShallowRef } from "vue";
import { parseReportTemplate, type ReportTemplateDocument } from "@agile-team/mach-report";

export interface TemplateWorkbenchTaskContext { signal: AbortSignal }
export interface TemplateWorkbenchOptions {
  blocked?: () => boolean;
  /** Return guards in the visible-first order, including mounted hidden workspaces. */
  guards?: () => readonly (() => boolean | Promise<boolean>)[];
  prepare?: () => ReportTemplateDocument | undefined | Promise<ReportTemplateDocument | undefined>;
  apply?: (document: ReportTemplateDocument, context: TemplateWorkbenchTaskContext) => boolean | void | Promise<boolean | void>;
  applied?: (document: ReportTemplateDocument) => void | Promise<void>;
  onError?: (cause: unknown) => void;
}

/** Optional task orchestration shared by workbench shells, using their existing editor and manager. */
export function useTemplateWorkbench(options: TemplateWorkbenchOptions): {
  operating: Ref<boolean>;
  busy: ComputedRef<boolean>;
  error: ShallowRef<unknown>;
  run: <T>(action: (context: TemplateWorkbenchTaskContext) => T | Promise<T>) => Promise<T | undefined>;
  guardChanges: () => Promise<boolean>;
  apply: () => Promise<boolean>;
  dispose: () => void;
} {
  const operating = ref(false), error = shallowRef<unknown>();
  const busy = computed(() => operating.value || options.blocked?.() === true);
  let disposed = false, active: AbortController | undefined;
  function dispose(): void { disposed = true; active?.abort(); }
  if (getCurrentScope()) onScopeDispose(dispose);

  async function run<T>(action: (context: TemplateWorkbenchTaskContext) => T | Promise<T>): Promise<T | undefined> {
    if (busy.value || disposed) return;
    const controller = new AbortController(); active = controller;
    operating.value = true; error.value = undefined;
    try {
      const result = await action({ signal: controller.signal });
      if (!disposed) return result;
    } catch (cause) {
      if (!disposed) { error.value = cause; options.onError?.(cause); }
    } finally { active = undefined; operating.value = false; }
  }
  async function guardChanges(): Promise<boolean> {
    for (const guard of options.guards?.() ?? []) {
      if (disposed || !(await guard())) return false;
    }
    return !disposed;
  }
  async function apply(): Promise<boolean> {
    const result = await run(async context => {
      const document = await options.prepare?.();
      if (!document || context.signal.aborted || !options.apply) return false;
      const snapshot = parseReportTemplate(document);
      const accepted = await options.apply(snapshot, context);
      if (accepted === false || context.signal.aborted) return false;
      await options.applied?.(snapshot);
      return true;
    });
    return result === true;
  }
  return { operating, busy, error, run, guardChanges, apply, dispose };
}
