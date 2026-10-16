// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { useDiscardGuard } from "../composables/useDiscardGuard";
import { usePreviewTask } from "../composables/usePreviewTask";
import { usePreviewDiagnostics } from "../composables/usePreviewDiagnostics";
import { useMachReport, type MachReportController } from "../controller";
import ReportPreview from "../ReportPreview.vue";
import type { RenderPlan } from "@agile-team/mach-report";

const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); document.body.replaceChildren(); });
function plan(value = 5): RenderPlan {
  return { schemaVersion: "product-workflow", pages: [{ pageWidthMm: 210, pageHeightMm: 100, components: [{
    kind: "rect", leftMm: 2, topMm: 2, widthMm: 40, heightMm: 8,
    grid: { cells: [[{ text: String(value), value, valueType: "number" }]] }
  }] }] };
}
async function fixture(props: Record<string, unknown> = {}) {
  const fetcher = vi.fn(async () => plan());
  const wrapper = mount(ReportPreview, { attachTo: document.body, props: { reportId: "daily", fetcher, editable: true, showPdfWindow: false, showExport: false, ...props } });
  mounted.push(wrapper);
  const api = wrapper.vm as unknown as MachReportController;
  await vi.waitFor(() => expect(api.state?.hasPlan).toBe(true));
  return { wrapper, api, fetcher };
}
async function begin(wrapper: VueWrapper) {
  await wrapper.find("td[data-mr-row-index]").trigger("dblclick");
  await flushPromises();
  return wrapper.find(".mrp-cell-editor");
}

describe("replacement guard decisions", () => {
  it("has a built-in decision, isolates a late hook and cancels on cleanup", async () => {
    const errors = vi.fn();
    const guard = useDiscardGuard({ pending: () => true, enabled: () => true, reportIds: () => ["a"], hook: () => undefined, error: errors });
    const first = guard.check("reload");
    expect(guard.request.value?.reportIds).toEqual(["a"]);
    const second = guard.check("import");
    expect(await first).toBe(false);
    guard.settle(true); expect(await second).toBe(true);
    const third = guard.check("leave"); guard.cancel(); expect(await third).toBe(false);
    expect(errors).not.toHaveBeenCalled();
  });
  it("does not approve a newer request with a previous asynchronous answer", async () => {
    const answers: Array<(answer: boolean) => void> = [];
    const guard = useDiscardGuard({ pending: () => true, enabled: () => true, reportIds: () => [], hook: () => () => new Promise<boolean>((resolve) => answers.push(resolve)), error: vi.fn() });
    const old = guard.check("reload"); await Promise.resolve(); const next = guard.check("import"); await Promise.resolve();
    answers[0]!(true); expect(await old).toBe(false);
    answers[1]!(false); expect(await next).toBe(false);
  });
  it("treats thrown confirmation hooks as a rejection", async () => {
    const error = vi.fn();
    const guard = useDiscardGuard({ pending: () => true, enabled: () => true, reportIds: () => [], hook: () => () => { throw new Error("offline"); }, error });
    expect(await guard.check("replace")).toBe(false); expect(error).toHaveBeenCalledOnce();
  });
  it("settles a cancelled host hook and rejects an approval for a changed draft snapshot", async () => {
    let revision = 0;
    let approve!: (value: boolean) => void;
    const guard = useDiscardGuard({ pending: () => true, enabled: () => true, reportIds: () => [], snapshot: () => [revision], hook: () => () => new Promise<boolean>((resolve) => { approve = resolve; }), error: vi.fn() });
    const old = guard.check("leave"); await Promise.resolve(); guard.cancel(); expect(await old).toBe(false);
    const next = guard.check("reload"); await Promise.resolve(); revision++; approve(true); expect(await next).toBe(false);
  });
});

describe("preview product workflows", () => {
  it("keeps a local draft on rejected reload and replaces only after explicit approval", async () => {
    const { wrapper, api, fetcher } = await fixture();
    const input = await begin(wrapper); await input.setValue("8"); await input.trigger("keydown", { key: "Enter" }); await flushPromises();
    expect(api.state?.pendingLocalChanges).toBe(true);
    const rejected = api.reload(); await flushPromises();
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(true);
    await wrapper.find('[role="alertdialog"] button').trigger("click"); await rejected;
    expect(fetcher).toHaveBeenCalledOnce(); expect(api.getPlan!()!.pages[0]!.components[0]!.grid!.cells[0]![0]!.value).toBe(8);
    const accepted = api.reload(); await flushPromises();
    await wrapper.findAll('[role="alertdialog"] button')[1]!.trigger("click"); await accepted;
    expect(fetcher).toHaveBeenCalledTimes(2); expect(api.state?.pendingLocalChanges).toBe(false);
  });
  it("tracks persisted differences separately from unsaved local changes", async () => {
    const save = vi.fn(); const { wrapper, api, fetcher } = await fixture({ editable: { save } });
    const input = await begin(wrapper); await input.setValue("0"); await input.trigger("keydown", { key: "Enter" }); await flushPromises();
    expect(save).toHaveBeenCalledOnce(); expect(api.state?.dirty).toBe(true); expect(api.state?.pendingLocalChanges).toBe(false);
    await api.reload(); expect(fetcher).toHaveBeenCalledTimes(2); expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
  });
  it("settles a cancelled raw fetcher that ignores signal and suppresses its late events/results", async () => {
    let resolve!: (value: RenderPlan) => void;
    const fetcher = vi.fn(() => new Promise<RenderPlan>((done) => { resolve = done; }));
    const wrapper = mount(ReportPreview, { props: { reportId: "a", fetcher, autoLoad: false } }); mounted.push(wrapper);
    const api = wrapper.vm as unknown as MachReportController;
    const pending = api.reload(); await flushPromises();
    expect(api.state?.task?.status).toBe("running"); api.cancelTask!();
    await pending; expect(api.state?.loading).toBe(false); expect(api.state?.task?.status).toBe("cancelled");
    resolve(plan(99)); await flushPromises();
    expect(api.state?.hasPlan).toBe(false); expect(wrapper.emitted("error")).toBeUndefined(); expect(wrapper.emitted("loaded")).toBeUndefined();
  });
  it("rejects a lossy export in strict mode and exposes located diagnostics", async () => {
    const input = plan(); input.pages[0]!.components.push({ kind: "chart", nid: "missing-chart", leftMm: 50, topMm: 5, widthMm: 20, heightMm: 20 });
    const { wrapper, api } = await fixture({ fetcher: async () => input, output: { fidelity: "strict" } });
    await api.exportAs("xlsx");
    expect(api.state?.diagnostics?.some((item) => item.code === "missing-image" && item.format === "xlsx" && item.pageIndex === 0)).toBe(true);
    expect(api.state?.error?.code).toBe("export"); expect(wrapper.find(".mrp-diagnostics").exists()).toBe(true);
    expect(api.getOutputDiagnostics!("xlsx")).toHaveLength(1); expect(wrapper.emitted("diagnostic")?.length).toBe(2);
  });
  it("protects active input from a declined import and exposes a reusable route guard", async () => {
    const beforeDiscard = vi.fn(() => false); const { wrapper, api } = await fixture({ beforeDiscard });
    const input = await begin(wrapper); await input.setValue("7");
    expect(api.state?.pendingLocalChanges).toBe(true);
    expect(await api.importExcel!(new Uint8Array())).toBeNull(); expect(wrapper.find(".mrp-cell-editor").exists()).toBe(true);
    expect(await api.confirmDiscard!("leave")).toBe(false);
    expect(beforeDiscard.mock.calls.map((args) => (args as unknown as [{ reason: string }])[0].reason)).toEqual(["import", "leave"]);
  });
  it("stable parent handle reads the new optional state and task methods", async () => {
    const { api } = await fixture(); const handle = useMachReport(); handle.ref(api);
    expect(handle.state.pendingLocalChanges).toBe(false); expect(handle.state.reportIds).toEqual(["daily"]);
    expect(handle.state.params).toEqual({}); expect(await handle.confirmDiscard()).toBe(true); expect(handle.getOutputDiagnostics("dom")).toEqual([]);
    handle.cancelTask();
  });
});

describe("task and diagnostics observer boundaries", () => {
  it("does not let a previous task overwrite the current one and isolates observer errors", () => {
    const task = usePreviewTask(() => { throw new Error("observer"); });
    const old = task.start("query", "query", vi.fn()); const current = task.start("import", "import", vi.fn());
    old.update("layout"); old.finish(); expect(task.state.value?.taskId).toBe(current.taskId);
    task.cancel(); current.update("assets"); expect(task.state.value?.status).toBe("cancelled");
  });
  it("batches immutable diagnostics and avoids duplicate output reports", () => {
    const observer = vi.fn(); const diagnostics = usePreviewDiagnostics(observer);
    const entry = { code: "warning", message: "field missing", severity: "warning" as const, pageIndex: 1 };
    diagnostics.addMany([entry, entry]); expect(diagnostics.entries.value).toHaveLength(1); expect(observer).toHaveBeenCalledOnce();
    expect(Object.isFrozen(diagnostics.entries.value[0])).toBe(true); diagnostics.reset(); expect(diagnostics.entries.value).toEqual([]);
  });
  it("does not restore old diagnostics after an observer resets or replaces the report", () => {
    const diagnostics = usePreviewDiagnostics(() => diagnostics.reset());
    diagnostics.addMany([{ code: "old", message: "old first", severity: "warning" }, { code: "old2", message: "old second", severity: "warning" }]);
    expect(diagnostics.entries.value).toEqual([]);
  });
});
