import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { draftStorageLimits, templateDraftKey, type TemplateDraftStorage } from "./draft-storage";
import { mutateTemplateDraft, waitTemplateDraftMutations } from "./draft-storage-queue";
import { parseWorkspaceView, type DesignerWorkspaceView } from "./workspace-view";

/** Persists only the existing workspace's coordinates, separately from content recovery and dirty state. */
export function useTemplateWorkspaceStorage(options: {
  storage(): TemplateDraftStorage | undefined;
  id(): string;
  changed(): unknown;
  read(): DesignerWorkspaceView;
  restore(view: DesignerWorkspaceView, signal: AbortSignal): Promise<boolean | undefined>;
}) {
  const available = shallowRef<DesignerWorkspaceView>();
  const error = ref(""), adjusted = ref(false);
  let generation = 0, disposed = false, ready = false, timer: ReturnType<typeof setTimeout> | undefined;
  let controller = new AbortController(), readController = new AbortController();
  let current: { storage: TemplateDraftStorage; key: string; delay: number } | undefined;
  async function open(): Promise<void> {
    clearTimeout(timer); generation++; controller.abort(); readController.abort(); controller = new AbortController(); readController = new AbortController();
    available.value = undefined; error.value = ""; adjusted.value = false; ready = false; current = undefined;
    const storage = options.storage(); if (!storage?.rememberView) return;
    const job = generation;
    try {
      current = { storage, key: `${templateDraftKey(storage.scope, options.id())}:view`, delay: draftStorageLimits(storage).debounceMs };
      await waitTemplateDraftMutations(storage.adapter, current.key);
      if (job !== generation || disposed) return;
      const raw = await storage.adapter.read(current.key, { signal: readController.signal });
      if (job !== generation || disposed) return;
      available.value = raw === null ? undefined : parseWorkspaceView(raw, options.id());
    } catch (cause) { if (job === generation && !disposed) error.value = cause instanceof Error ? cause.message : String(cause); }
    finally { if (job === generation && !disposed) ready = true; }
  }
  function flush(): void {
    clearTimeout(timer); timer = undefined;
    if (!current || !ready || available.value) return;
    const context = current, job = generation, signal = controller.signal;
    try {
      const value = JSON.stringify(options.read()); parseWorkspaceView(value, options.id());
      void mutateTemplateDraft(context.storage.adapter, context.key, async () => {
        if (signal.aborted) return;
        await context.storage.adapter.write(context.key, value, { signal });
        if (job === generation && !disposed) error.value = "";
      }).catch(cause => { if (job === generation && !disposed) error.value = cause instanceof Error ? cause.message : String(cause); });
    } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  }
  function schedule(): void {
    clearTimeout(timer);
    if (current && ready && !available.value) timer = setTimeout(flush, current.delay);
  }
  async function resume(): Promise<void> {
    if (!available.value) return;
    const view = available.value, job = generation;
    try {
      const changed = await options.restore(view, controller.signal);
      if (job !== generation || disposed || changed === undefined) return;
      adjusted.value = changed; available.value = undefined; schedule();
    } catch (cause) { if (job === generation && !disposed) error.value = cause instanceof Error ? cause.message : String(cause); }
  }
  function dismiss(): void { available.value = undefined; schedule(); }
  watch([options.id, () => options.storage()?.scope, () => options.storage()?.adapter, () => options.storage()?.rememberView, () => options.storage()?.debounceMs], () => { void open(); }, { immediate: true });
  watch(options.changed, schedule, { deep: true });
  onMounted(() => { globalThis.addEventListener?.("pagehide", flush); });
  onBeforeUnmount(() => { globalThis.removeEventListener?.("pagehide", flush); flush(); disposed = true; readController.abort(); clearTimeout(timer); /* same-key remount waits for the bounded final mutation */ });
  return { available, error, adjusted, resume, dismiss, flush };
}
