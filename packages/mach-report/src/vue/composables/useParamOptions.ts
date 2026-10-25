import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { ReportParamDef } from "@agile-team/mach-report";
import { waitForOutput } from "../../output/progress";
import type { ReportParamOption, ReportParamOptionsLoader } from "../param-options";

const LIMIT = 100, CACHE_SIZE = 32, CACHE_TTL = 60_000, REQUEST_TIMEOUT = 15_000;
function snapshotOptions(value: readonly ReportParamOption[]): readonly ReportParamOption[] {
  let count = 0;
  const visited = new Set<unknown>();
  function copy(items: readonly ReportParamOption[], depth: number): readonly ReportParamOption[] {
    if (!Array.isArray(items) || depth > 16 || items.length > LIMIT) throw new Error("Invalid option response");
    const siblings = new Set<string>();
    return Object.freeze(items.map(option => {
      if (++count > LIMIT || !option || visited.has(option) || typeof option.value !== "string" || !option.value || option.value.length > 1024 || typeof option.label !== "string" || option.label.length > 1024 || siblings.has(option.value)) throw new Error("Invalid option response");
      visited.add(option); siblings.add(option.value);
      return Object.freeze({ label: option.label, value: option.value, ...(option.children === undefined ? {} : { children: copy(option.children, depth + 1) }) });
    }));
  }
  return copy(value, 1);
}

/** One request per field; stale callbacks never replace a later dependency/query snapshot. */
export function useParamOptions(host: {
  def(): ReportParamDef;
  values(): Readonly<Record<string, string>>;
  loader(): ReportParamOptionsLoader | undefined;
  opened(): boolean;
  disabled(): boolean;
}) {
  const query = ref("");
  const options = shallowRef<readonly ReportParamOption[]>([]);
  const loading = ref(false), failed = ref(false);
  const params = computed(() => Object.fromEntries((Array.isArray(host.def().dependsOn) ? host.def().dependsOn! : []).map(field => [field, host.values()[field] ?? ""])));
  const waiting = computed(() => Object.values(params.value).some(value => !value.trim()));
  const missingLoader = computed(() => !host.loader());
  const cache = new Map<string, { at: number; options: readonly ReportParamOption[] }>();
  let controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined, generation = 0;
  function cancel(): void { generation++; controller?.abort(); controller = undefined; clearTimeout(timer); loading.value = false; }
  async function request(): Promise<void> {
    cancel(); failed.value = false;
    const loader = host.loader(), def = host.def();
    if (!loader || !def.optionsSource || waiting.value || host.disabled() || !host.opened()) return;
    const input = { source: def.optionsSource, field: def.field, query: query.value.trim().slice(0, 256), params: Object.freeze({ ...params.value }), limit: LIMIT };
    const key = JSON.stringify(input), cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL) { cache.delete(key); cache.set(key, cached); options.value = cached.options; return; }
    const job = generation, current = new AbortController(); controller = current; loading.value = true;
    const timeout = setTimeout(() => current.abort(), REQUEST_TIMEOUT);
    try {
      const result = snapshotOptions(await waitForOutput(loader(Object.freeze({ ...input, signal: current.signal })), current.signal));
      if (job !== generation) return;
      options.value = result; cache.delete(key); cache.set(key, { at: Date.now(), options: result });
      while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    } catch { if (job === generation) failed.value = true; }
    finally { clearTimeout(timeout); if (job === generation) { loading.value = false; controller = undefined; } }
  }
  function schedule(): void { cancel(); options.value = []; failed.value = false; timer = setTimeout(() => { void request(); }, 180); }
  watch(query, schedule, { flush: "sync" });
  watch([() => host.def().field, () => host.def().type, () => host.def().optionsSource, () => JSON.stringify(params.value), host.loader], () => {
    cache.clear(); query.value = ""; cancel(); options.value = []; failed.value = false;
    if (host.opened()) void request();
  }, { flush: "sync" });
  watch([host.opened, host.disabled], () => {
    if (!host.opened() || host.disabled()) cancel(); else void request();
  }, { immediate: true });
  onBeforeUnmount(() => { cancel(); cache.clear(); });
  return { query, options, loading, failed, waiting, missingLoader, request, cancel };
}
