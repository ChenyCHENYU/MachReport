import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { serializeReportTemplate } from "@agile-team/mach-report";
import { mutateTemplateDraft, waitTemplateDraftMutations } from "./draft-storage-queue";
import { draftStorageLimits, parseTemplateDraft, templateDraftKey, type TemplateDraftRecord, type TemplateDraftStorage } from "./draft-storage";

export function useTemplateDraftRecovery(options: {
  storage: () => TemplateDraftStorage | undefined;
  id: () => string;
  baseline: () => string;
  pending: () => boolean;
  snapshot: () => TemplateDraftRecord;
  changedSource: () => unknown;
  restore: (record: TemplateDraftRecord) => void;
}) {
  const checking = ref(false);
  const available = shallowRef<TemplateDraftRecord>(), error = ref(""), status = ref<"idle" | "saving" | "saved">("idle");
  const stale = computed(() => !!available.value && serializeReportTemplate(available.value.baseline) !== options.baseline());
  let timer: ReturnType<typeof setTimeout> | undefined, generation = 0, disposed = false, unreadable = false;
  let controller = new AbortController(), readController = new AbortController(), queue = Promise.resolve();
  let current: { storage: TemplateDraftStorage; key: string; maxBytes: number; debounceMs: number } | undefined;
  function cancel(): void { clearTimeout(timer); timer = undefined; generation++; controller.abort(); readController.abort(); controller = new AbortController(); readController = new AbortController(); }
  function report(cause: unknown, job: number): void { if (!disposed && job === generation) error.value = cause instanceof Error ? cause.message : String(cause); }
  async function open(): Promise<void> {
    cancel(); const job = generation; checking.value = true; unreadable = false; available.value = undefined; error.value = ""; status.value = "idle"; current = undefined;
    try {
      const storage = options.storage(); if (!storage) return;
      const id = options.id(); current = { storage, key: templateDraftKey(storage.scope, id), ...draftStorageLimits(storage) };
      await waitTemplateDraftMutations(storage.adapter, current.key);
      if (job !== generation || disposed) return;
      const raw = await storage.adapter.read(current.key, { signal: readController.signal });
      if (job !== generation || disposed || raw === null) return;
      available.value = parseTemplateDraft(raw, id, current.maxBytes);
    } catch (cause) { if (job === generation) unreadable = true; report(cause, job); }
    finally { if (job === generation && !disposed) checking.value = false; }
  }
  function enqueue(value: string | null): void {
    const context = current; if (!context) return;
    const job = generation, signal = controller.signal;
    status.value = "saving";
    const write = async () => {
      if (signal.aborted) return;
      if (value === null) await context.storage.adapter.remove(context.key, { signal });
      else await context.storage.adapter.write(context.key, value, { signal });
      if (!disposed && job === generation) { status.value = value === null ? "idle" : "saved"; error.value = ""; }
    };
    queue = mutateTemplateDraft(context.storage.adapter, context.key, write).catch(cause => report(cause, job));
  }
  function flush(): void {
    clearTimeout(timer); timer = undefined;
    if (!current || available.value) return;
    try {
      if (!options.pending()) { if (!unreadable) enqueue(null); return; }
      const raw = JSON.stringify(options.snapshot());
      parseTemplateDraft(raw, options.id(), current.maxBytes);
      enqueue(raw);
    } catch (cause) { report(cause, generation); }
  }
  function schedule(): void {
    clearTimeout(timer); if (!current || available.value) return;
    timer = setTimeout(flush, current.debounceMs);
  }
  async function discard(): Promise<void> { available.value = undefined; unreadable = false; enqueue(null); await queue; schedule(); }
  function restore(): void {
    if (!available.value) return;
    try { options.restore(available.value); available.value = undefined; schedule(); }
    catch (cause) { report(cause, generation); }
  }
  watch([options.id, () => options.storage()?.scope, () => options.storage()?.adapter, () => options.storage()?.maxBytes, () => options.storage()?.debounceMs], () => { void open(); }, { immediate: true });
  watch([options.pending, options.changedSource], schedule, { deep: true });
  onMounted(() => { globalThis.addEventListener?.("pagehide", flush); });
  onBeforeUnmount(() => { globalThis.removeEventListener?.("pagehide", flush); flush(); disposed = true; readController.abort(); clearTimeout(timer); /* queued final write may finish; all UI updates are fenced */ });
  return { available, stale, error, status, checking, restore, discard, flush };
}
