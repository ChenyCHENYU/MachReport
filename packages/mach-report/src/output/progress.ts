/** Stage counts are exact completed units; encoding libraries may remain indeterminate. */
export interface OutputTaskOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}
export function assertOutputActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}
export function notifyOutputProgress(options: OutputTaskOptions, completed: number, total: number): void {
  assertOutputActive(options.signal);
  try { options.onProgress?.(completed, total); } catch { /* Observers do not own output transactions. */ }
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
