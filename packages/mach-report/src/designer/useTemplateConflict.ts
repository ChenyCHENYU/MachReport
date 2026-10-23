import { computed, onBeforeUnmount, ref, shallowRef } from "vue";
import { diffReportTemplates, parseReportTemplate, type ReportTemplateDocument } from "@agile-team/mach-report";
export interface TemplateConflictContext { id: string; signal: AbortSignal }
export interface TemplateCopyContext extends TemplateConflictContext { sourceRevision?: string }
export interface TemplateEditorConflictOptions {
  loadLatest?: (context: TemplateConflictContext) => Promise<ReportTemplateDocument>;
  /** The host chooses the new persistent identity. The local draft remains untouched. */
  keepCopy?: (document: ReportTemplateDocument, context: TemplateCopyContext) => Promise<void>;
}
export function useTemplateConflict(options: {
  configuration: () => TemplateEditorConflictOptions;
  baseline: () => ReportTemplateDocument;
  local: () => ReportTemplateDocument;
  applyLatest: (document: ReportTemplateDocument) => Promise<boolean>;
  rebase: (latest: ReportTemplateDocument) => void;
}) {
  const active = ref(false), latest = shallowRef<ReportTemplateDocument>(), busy = ref(false), error = ref(""), confirmRebase = ref(false), copied = ref(false);
  let generation = 0, controller: AbortController | undefined;
  const localChanges = computed(() => diffReportTemplates(options.baseline(), options.local(), { maxChanges: 100 }));
  const remoteChanges = computed(() => latest.value ? diffReportTemplates(options.baseline(), latest.value, { maxChanges: 100 }) : undefined);
  function cancel(): void { generation++; controller?.abort(); controller = undefined; busy.value = false; }
  function clear(): void { cancel(); active.value = false; latest.value = undefined; error.value = ""; confirmRebase.value = false; copied.value = false; }
  async function load(): Promise<void> {
    const read = options.configuration().loadLatest; if (!read || busy.value) return;
    cancel(); const job = generation, id = options.local().id;
    controller = new AbortController(); busy.value = true; error.value = "";
    try {
      const value = parseReportTemplate(await read({ id, signal: controller.signal }));
      if (job !== generation) return;
      if (value.id !== id) throw new Error("Latest template identity does not match");
      latest.value = value;
    } catch (cause) { if (job === generation) error.value = cause instanceof Error ? cause.message : String(cause); }
    finally { if (job === generation) busy.value = false; }
  }
  function begin(remote?: ReportTemplateDocument): void { clear(); active.value = true; if (remote) latest.value = parseReportTemplate(remote); else void load(); }
  async function adoptLatest(): Promise<void> {
    if (!latest.value || busy.value) return;
    if (await options.applyLatest(parseReportTemplate(latest.value))) clear();
  }
  function rebase(): void {
    if (!latest.value || busy.value || !confirmRebase.value) return;
    try { options.rebase(parseReportTemplate(latest.value)); clear(); }
    catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  }
  async function keepCopy(): Promise<void> {
    const keep = options.configuration().keepCopy; if (!keep || busy.value) return;
    cancel(); const job = generation, document = parseReportTemplate(options.local());
    controller = new AbortController(); busy.value = true; error.value = "";
    try {
      await keep(document, { id: document.id, sourceRevision: document.revision, signal: controller.signal });
      if (job === generation) copied.value = true;
    } catch (cause) { if (job === generation) error.value = cause instanceof Error ? cause.message : String(cause); }
    finally { if (job === generation) busy.value = false; }
  }
  onBeforeUnmount(cancel);
  return { active, latest, busy, error, confirmRebase, copied, localChanges, remoteChanges, begin, clear, load, adoptLatest, rebase, keepCopy, toggleRebase: () => { confirmRebase.value = !confirmRebase.value; } };
}
