import { effectScope } from "vue";
import { describe, expect, it, vi } from "vitest";
import { defineReportTemplate } from "@agile-team/mach-report";
import { useTemplateWorkbench } from "../useTemplateWorkbench";

const document = defineReportTemplate({ id: "test", name: "Test", template: { pages: [{ widthMm: 80, heightMm: 55, components: [] }] } });

describe("optional workbench task orchestration", () => {
  it("awaits the real apply result and deduplicates concurrent actions", async () => {
    let finish!: (value: boolean) => void;
    const apply = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const applied = vi.fn();
    const scope = effectScope();
    const workbench = scope.run(() => useTemplateWorkbench({ prepare: () => document, apply, applied }))!;
    const pending = workbench.apply(); await Promise.resolve();
    expect(workbench.busy.value).toBe(true);
    expect(await workbench.apply()).toBe(false);
    expect(applied).not.toHaveBeenCalled();
    finish(true); expect(await pending).toBe(true);
    expect(applied).toHaveBeenCalledOnce(); expect(workbench.busy.value).toBe(false);
    scope.stop();
  });
  it("retains the workspace on cancellation and reports a failed callback without success", async () => {
    const cause = new Error("server refused"); const onError = vi.fn(), applied = vi.fn();
    const scope = effectScope();
    const workbench = scope.run(() => useTemplateWorkbench({ prepare: () => document, apply: () => { throw cause; }, applied, onError }))!;
    expect(await workbench.apply()).toBe(false); expect(onError).toHaveBeenCalledWith(cause);
    expect(workbench.error.value).toBe(cause); expect(applied).not.toHaveBeenCalled();
    scope.stop();
    const cancelScope = effectScope();
    const cancelled = cancelScope.run(() => useTemplateWorkbench({ prepare: () => document, apply: () => false, applied }))!;
    expect(await cancelled.apply()).toBe(false); expect(applied).not.toHaveBeenCalled(); cancelScope.stop();
  });
  it("guards mounted hidden workspaces in host order and stops on declined discard", async () => {
    const report = vi.fn(() => true), labels = vi.fn(() => false), skipped = vi.fn(() => true);
    const scope = effectScope();
    const workbench = scope.run(() => useTemplateWorkbench({ guards: () => [report, labels, skipped] }))!;
    expect(await workbench.guardChanges()).toBe(false); expect(report).toHaveBeenCalledOnce(); expect(labels).toHaveBeenCalledOnce(); expect(skipped).not.toHaveBeenCalled(); scope.stop();
  });
  it("aborts disposal and suppresses late completion and error feedback", async () => {
    let finish!: () => void; let signal!: AbortSignal;
    const applied = vi.fn(), onError = vi.fn(); const scope = effectScope();
    const workbench = scope.run(() => useTemplateWorkbench({ prepare: () => document, apply: (_document, context) => { signal = context.signal; return new Promise<void>(resolve => { finish = resolve; }); }, applied, onError }))!;
    const pending = workbench.apply(); await Promise.resolve(); scope.stop();
    expect(signal.aborted).toBe(true); finish(); expect(await pending).toBe(false); expect(applied).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
  });
  it("skips unavailable preparation and blocked editors", async () => {
    const apply = vi.fn(), scope = effectScope();
    const workbench = scope.run(() => useTemplateWorkbench({ prepare: () => undefined, apply }))!;
    expect(await workbench.apply()).toBe(false); expect(apply).not.toHaveBeenCalled(); scope.stop();
    const blockedScope = effectScope();
    const blocked = blockedScope.run(() => useTemplateWorkbench({ blocked: () => true, prepare: () => document, apply }))!;
    expect(await blocked.apply()).toBe(false); expect(apply).not.toHaveBeenCalled(); blockedScope.stop();
  });
});
