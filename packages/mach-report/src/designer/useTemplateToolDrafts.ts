import { inject, onBeforeUnmount, provide, ref, watch, type InjectionKey } from "vue";
import type { TemplateToolDraft } from "./draft-storage";
interface ToolBridge {
  read(key: string): TemplateToolDraft | undefined;
  write(key: string, value?: TemplateToolDraft): void;
  epoch: { value: number };
}
const toolBridge: InjectionKey<ToolBridge> = Symbol("mach-report:tool-drafts");
export function provideTemplateToolDrafts(onPending: (tool: string, pending: boolean) => void) {
  const records = ref<Record<string, TemplateToolDraft>>({}), epoch = ref(0);
  const bridge: ToolBridge = {
    epoch,
    read: key => records.value[key],
    write(key, value) {
      const next = { ...records.value };
      if (value) next[key] = value; else delete next[key];
      records.value = next;
      const tool = key.split(":")[0]!;
      onPending(tool, Object.keys(next).some(item => item.split(":")[0] === tool));
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
  restore: (value: string, baseline: string) => void;
}): void {
  const bridge = inject(toolBridge, undefined);
  if (!bridge) return;
  let restoring = false;
  const restore = () => {
    const record = bridge.read(options.key());
    if (!record) return;
    restoring = true;
    try { options.restore(record.value, record.baseline); } finally { restoring = false; }
  };
  watch([options.key, () => bridge.epoch.value], restore, { immediate: true, flush: "sync" });
  const stop = watch([options.pending, options.snapshot], () => {
    if (restoring) return;
    bridge.write(options.key(), options.pending() ? { baseline: options.baseline(), value: options.snapshot() } : undefined);
  }, { flush: "post" });
  onBeforeUnmount(stop);
}
