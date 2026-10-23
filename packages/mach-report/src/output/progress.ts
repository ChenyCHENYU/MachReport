/** Stage counts are exact completed units; encoding libraries may remain indeterminate. */
export interface OutputTaskOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}
export function assertOutputActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}
/** Observers cannot change a completed transaction, including asynchronously rejected callbacks. */
export function observeOutput(callback: () => unknown): void {
  try { void Promise.resolve(callback()).catch(() => undefined); } catch { /* Observers do not own output transactions. */ }
}
export function notifyOutputProgress(options: OutputTaskOptions, completed: number, total: number): void {
  assertOutputActive(options.signal);
  observeOutput(() => options.onProgress?.(completed, total));
  assertOutputActive(options.signal);
}
/** Stop waiting on an adapter that ignores signal; its late result is never committed. */
export function waitForOutput<T>(pending: PromiseLike<T> | T, signal?: AbortSignal): Promise<T> {
  const source = Promise.resolve(pending);
  if (signal?.aborted) {
    // The adapter may have synchronously cancelled before returning a rejected Promise.
    void source.catch(() => {});
    return Promise.reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
  }
  if (!signal) return source;
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => { cleanup(); reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    source.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}
export function forwardOutputAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  const abort = () => target.abort(source?.reason);
  source?.addEventListener("abort", abort, { once: true });
  if (source?.aborted) abort();
  return () => source?.removeEventListener("abort", abort);
}
/** Opt-in yielding lets a browser consume cancellation and paint stage progress between units. */
export async function outputCheckpoint(options: OutputTaskOptions, completed: number, total: number): Promise<void> {
  notifyOutputProgress(options, completed, total);
  if (options.signal || options.onProgress) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assertOutputActive(options.signal);
}

/** Cooperative encoding slices keep a single large logical Sheet cancellable. Counts stay stage-owned. */
export function createOutputScheduler(options: OutputTaskOptions): (units?: number) => Promise<void> | undefined {
  let count = 0, started = Date.now();
  return (units = 1) => {
    assertOutputActive(options.signal); count += units;
    if (count < 4096 && Date.now() - started < 8) return;
    count = 0;
    return new Promise<void>(resolve => setTimeout(resolve, 0)).then(() => { started = Date.now(); assertOutputActive(options.signal); });
  };
}
