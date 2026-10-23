import { assertOutputActive, observeOutput } from "./progress";
import type { OutputDiagnostic, OutputDiagnosticOptions } from "./capabilities";

/** Internal notification: observers cannot fail output, but synchronous cancellation takes effect. */
export function notifyOutputDiagnostic(entry: OutputDiagnostic, options: OutputDiagnosticOptions): void {
  assertOutputActive(options.signal);
  observeOutput(() => options.onDiagnostic?.(entry));
  assertOutputActive(options.signal);
}
