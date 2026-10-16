import { assertOutputActive } from "./progress";
import type { OutputDiagnostic, OutputDiagnosticOptions } from "./capabilities";

/** Internal notification: observers cannot fail output, but synchronous cancellation takes effect. */
export function notifyOutputDiagnostic(entry: OutputDiagnostic, options: OutputDiagnosticOptions): void {
  assertOutputActive(options.signal);
  try { options.onDiagnostic?.(entry); } catch { /* Observers do not own output transactions. */ }
  assertOutputActive(options.signal);
}
