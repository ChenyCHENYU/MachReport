import type { TemplateDraftStorageAdapter } from "./draft-storage";
interface Operation { run: () => void | Promise<void>; resolve: () => void; reject: (cause: unknown) => void }
interface Queue { latest?: Operation; done: Promise<void>; finish: () => void }
const adapters = new WeakMap<TemplateDraftStorageAdapter, Map<string, Queue>>();
/** One active mutation and one coalesced latest mutation per adapter/key, across editor remounts. */
export function mutateTemplateDraft(adapter: TemplateDraftStorageAdapter, key: string, run: Operation["run"]): Promise<void> {
  let keys = adapters.get(adapter);
  if (!keys) { keys = new Map(); adapters.set(adapter, keys); }
  const existing = keys.get(key);
  let resolve!: () => void, reject!: (cause: unknown) => void;
  const result = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  const operation = { run, resolve, reject };
  if (existing) { existing.latest?.resolve(); existing.latest = operation; return result; }
  let finish!: () => void;
  const queue: Queue = { done: new Promise<void>(done => { finish = done; }), finish: () => finish() };
  keys.set(key, queue);
  const advance = () => {
    const latest = queue.latest; queue.latest = undefined;
    if (latest) execute(latest);
    else { keys.delete(key); queue.finish(); }
  };
  const execute = (next: Operation) => {
    let value: void | Promise<void>;
    try { value = next.run(); } catch (cause) { next.reject(cause); advance(); return; }
    Promise.resolve(value).then(next.resolve, next.reject).then(advance);
  };
  execute(operation);
  return result;
}
export async function waitTemplateDraftMutations(adapter: TemplateDraftStorageAdapter, key: string): Promise<void> {
  await adapters.get(adapter)?.get(key)?.done;
}
