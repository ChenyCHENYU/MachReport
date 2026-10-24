import { effectScope } from "vue";
import { beforeEach, expect, it, vi } from "vitest";
import { useReportExportExecution } from "../composables/useReportExportExecution";
import type { ReportAutoExporter, ReportExportExecutionOptions } from "../../worker/auto-types";
import type { ReportRuntimePreparedExportInput } from "../../server/types";
const state = vi.hoisted(() => ({ controllers: [] as { options: ReportExportExecutionOptions; exporter: ReportAutoExporter; resolve: (result: never) => void; reject: (error: unknown) => void }[] }));
vi.mock("../../worker/auto", () => ({ createAutoReportExporter: (options: ReportExportExecutionOptions) => {
  let resolve!: (result: never) => void, reject!: (error: unknown) => void;
  const pending = new Promise<never>((yes, no) => { resolve = yes; reject = no; });
  const exporter = { exportPrepared: vi.fn(() => pending), cancel: vi.fn(() => reject(Object.assign(new Error("cancel"), { name: "AbortError" }))), dispose: vi.fn(() => reject(Object.assign(new Error("dispose"), { name: "AbortError" }))) };
  state.controllers.push({ options, exporter, resolve, reject }); return exporter;
} }));
const input: ReportRuntimePreparedExportInput = { format: "xlsx", prepared: { plan: { schemaVersion: "mach-report/1", pages: [] }, diagnostics: [], revisions: {}, stats: { rows: 0, cells: 0, pages: 0, durationMs: 0 } } };
const decision = { mode: "local" as const, reason: "small-task" as const, estimate: { pages: 1, cells: 2, bytes: 3 }, hardCancellation: false };
beforeEach(() => { state.controllers.length = 0; });
it("scope disposal cancels pending work and prevents subsequent exports", async () => {
  const scope = effectScope(); const hook = scope.run(() => useReportExportExecution(() => undefined))!;
  const pending = hook.exportPrepared(input); scope.stop();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(state.controllers).toHaveLength(0);
  await expect(hook.exportPrepared(input)).rejects.toThrow("卸载");
});
it("latest request owns decision while cancel keeps the hook reusable", async () => {
  const scope = effectScope(); const observer = vi.fn(async () => { throw new Error("observer"); });
  const hook = scope.run(() => useReportExportExecution(() => ({ onDecision: observer })))!;
  const first = hook.exportPrepared(input), second = hook.exportPrepared(input);
  await vi.dynamicImportSettled();
  state.controllers[1]!.options.onDecision?.(decision);
  state.controllers[0]!.options.onDecision?.({ ...decision, reason: "worker-unavailable" });
  expect(hook.decision.value?.reason).toBe("small-task"); expect(observer).toHaveBeenCalledOnce();
  hook.cancel(); await expect(first).rejects.toMatchObject({ name: "AbortError" }); await expect(second).rejects.toMatchObject({ name: "AbortError" });
  const third = hook.exportPrepared(input); state.controllers[2]!.resolve({} as never); await third;
  expect(state.controllers[2]!.exporter.dispose).toHaveBeenCalledOnce(); scope.stop();
});
it("forwards local overrides and new configuration once per operation", async () => {
  const scope = effectScope(); let mode: ReportExportExecutionOptions["mode"] = "local";
  const hook = scope.run(() => useReportExportExecution(() => ({ mode })))!;
  const local = vi.fn(); const pending = hook.exportPrepared(input, local);
  await vi.dynamicImportSettled();
  expect(state.controllers[0]!.exporter.exportPrepared).toHaveBeenCalledWith(expect.objectContaining({ format: input.format, prepared: input.prepared }), local);
  state.controllers[0]!.resolve({} as never); await pending;
  mode = "worker"; const next = hook.exportPrepared(input);
  expect(state.controllers[1]!.options.mode).toBe("worker"); state.controllers[1]!.resolve({} as never); await next; scope.stop();
});
