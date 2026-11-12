/** Internal cooperative work over already owned input. Capture/host callbacks
 * must finish before entering this runner; it never makes mutable input safe. */
export async function drainCooperatively<T>(work: Generator<void, T>, signal?: AbortSignal): Promise<T> {
  let started = performance.now(), units = 0;
  try {
    while (true) {
      checkCooperativeAbort(signal);
      const item = work.next();
      if (item.done) return item.value;
      if (++units < 8192 && (units % 64 !== 0 || performance.now() - started < 4)) continue;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      checkCooperativeAbort(signal);
      started = performance.now(); units = 0;
    }
  } finally { work.return(undefined as T); }
}
export function checkCooperativeAbort(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw Object.assign(new Error("报表处理已取消"), { name: "AbortError", cause: signal.reason });
}
