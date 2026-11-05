import { inject, onBeforeUnmount, provide, ref, watch, type InjectionKey } from "vue";
import type { TemplateToolDraft } from "./draft-storage";
interface ToolBridge {
  read(key: string): TemplateToolDraft | undefined;
  write(key: string, value?: TemplateToolDraft): void;
  epoch: { value: number };
}
const toolBridge: InjectionKey<ToolBridge> = Symbol("mach-report:tool-drafts");
export function provideTemplateToolDrafts(onPending: (tool: string, pending: boolean) => void, onChange?: () => void) {
  const records = ref<Record<string, TemplateToolDraft>>({}), epoch = ref(0);
  const bridge: ToolBridge = {
    epoch,
    read: key => records.value[key],
    write(key, value) {
      const previous = records.value[key];
      if (previous?.baseline === value?.baseline && previous?.value === value?.value) return;
      const next = { ...records.value };
      if (value) next[key] = value; else delete next[key];
      records.value = next;
      const tool = key.split(":")[0]!;
      onPending(tool, Object.keys(next).some(item => item.split(":")[0] === tool));
      onChange?.();
    },
  };
  provide(toolBridge, bridge);
  function restore(value: Record<string, TemplateToolDraft>): void {
    records.value = JSON.parse(JSON.stringify(value)) as typeof value;
    for (const tool of ["params", "rules", "excel"]) onPending(tool, Object.keys(value).some(key => key.split(":")[0] === tool));
    epoch.value++;
  }
  return { records, restore, clear: () => restore({}) };
}
/** Tool payloads contain declarations only. Never include source rows, workbook grids or preview values. */
export function useTemplateToolDraft(options: {
  key: () => string;
  baseline: () => string;
  pending: () => boolean;
  snapshot: () => string;
  reset?: () => void;
  restore: (value: string, baseline: string, context?: { pending: boolean }) => void;
}): void {
  const bridge = inject(toolBridge, undefined);
  if (!bridge) return;
  let restoring = false;
  let clean = { key: options.key(), baseline: options.baseline(), value: options.snapshot() };
  const restore = (current: readonly [string, number], previous?: readonly [string, number]) => {
    const record = bridge.read(options.key());
    if (!record && (!previous || current[1] === previous[1])) return;
    const state = record ?? (clean.key === current[0] ? clean : undefined);
    if (!state && !options.reset) return;
    restoring = true;
    try {
      if (!record && options.reset) options.reset();
      else if (state) options.restore(state.value, state.baseline, { pending: !!record });
    } finally { restoring = false; }
  };
  watch(() => [options.key(), bridge.epoch.value] as const, restore, { immediate: true, flush: "post" });
  const stop = watch([options.pending, options.snapshot], () => {
    if (restoring) return;
    if (!options.pending()) clean = { key: options.key(), baseline: options.baseline(), value: options.snapshot() };
    bridge.write(options.key(), options.pending() ? { baseline: options.baseline(), value: options.snapshot() } : undefined);
  }, { flush: "post" });
  onBeforeUnmount(stop);
}
