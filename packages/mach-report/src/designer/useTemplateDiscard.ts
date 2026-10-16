import { onBeforeUnmount, ref, shallowRef } from "vue";
import type { ReportTemplateDocument } from "@agile-team/mach-report";

export interface TemplateEditorBeforeDiscardContext {
  reason: "reset" | "replace";
  /** Independent snapshot of the current draft; it may contain invalid field values. */
  document: ReportTemplateDocument;
  replacement?: ReportTemplateDocument;
  pendingLocalChanges: true;
}
export type TemplateEditorBeforeDiscard = (context: TemplateEditorBeforeDiscardContext) => boolean | Promise<boolean>;

/** Host confirmations and the built-in prompt share latest-intent and unmount semantics. */
export function useTemplateDiscard(hook: () => TemplateEditorBeforeDiscard | undefined) {
  const confirmation = shallowRef<TemplateEditorBeforeDiscardContext | null>(null);
  const pending = ref(false);
  let complete: ((allow: boolean) => void) | undefined;
  let generation = 0;
  function decide(allow: boolean): void { complete?.(allow); complete = undefined; confirmation.value = null; }
  function cancel(): void { generation++; decide(false); pending.value = false; }
  async function request(context: TemplateEditorBeforeDiscardContext): Promise<boolean> {
    cancel(); const job = generation;
    const guard = hook(); pending.value = true;
    try {
      const allow = await new Promise<boolean>((resolve, reject) => {
        complete = resolve;
        if (!guard) { confirmation.value = context; return; }
        Promise.resolve().then(() => generation === job ? guard(context) : false).then((value) => {
          if (generation === job) decide(value === true);
        }, (cause: unknown) => {
          if (generation !== job) return;
          complete = undefined; confirmation.value = null; reject(cause);
        });
      });
      return generation === job && allow === true;
    } finally { if (generation === job) pending.value = false; }
  }
  onBeforeUnmount(cancel);
  return { confirmation, pending, decide, request, cancel };
}
