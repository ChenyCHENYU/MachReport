import { afterEach, expect, it, vi } from "vitest";
import { effectScope, shallowRef, type EffectScope } from "vue";
import { createReportCellEditBatch, type RenderPlan, type ReportCellEdit } from "../../index";
import { usePreviewConflictRecovery } from "../composables/usePreviewConflictRecovery";
import type { PreviewQueryCandidate } from "../composables/usePreviewSession";

const scopes: EffectScope[] = [];
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); });
function fixture(wait = Promise.resolve()) {
  const initial: RenderPlan = { schemaVersion: "conflict-generation", pages: [{ pageWidthMm: 80, pageHeightMm: 20, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 80, heightMm: 20,
    table: { id: "detail", role: "body", rowIndex: 0, columnKeys: ["qty", "note"], source: { datasetId: "detail", rowKey: "a", revision: 1 } }, grid: { cells: [[{ value: 1, text: "1" }, { value: "before", text: "before" }]] }
  }] }] };
  const edits = createReportCellEditBatch(initial, [
    { address: { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 }, value: 5 },
    { address: { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 1 }, value: "mine" }
  ], "intentions").edits;
  const plan = shallowRef<RenderPlan | null>(initial), query = shallowRef({ id: "A" });
  const pending = shallowRef<readonly ReportCellEdit[]>([edits[0]!]), revision = shallowRef(1);
  const retain = vi.fn((next: readonly ReportCellEdit[]) => { pending.value = next; revision.value++; });
  const accept = vi.fn((beforeEvents?: () => void) => { beforeEvents?.(); plan.value = structuredClone(initial); return true; });
  const prepare = vi.fn(async (): Promise<PreviewQueryCandidate> => {
    await wait;
    return { plan: structuredClone(initial), context: { reportIds: ["detail"], params: { plant: "A" }, sources: [] }, accept };
  });
  const apply = vi.fn(async () => true), scope = effectScope(); scopes.push(scope);
  const recovery = scope.run(() => usePreviewConflictRecovery({
    plan, query: () => query.value, pending: () => pending.value, pendingRevision: () => revision.value, pause: () => true, busy: () => false, canQuery: () => true,
    retain, prepare, apply, failure: () => "Validation failed", error: cause => String(cause), stale: () => "Intentions changed, requery required"
  }))!;
  const addIntent = () => { pending.value = [...edits]; revision.value++; };
  return { recovery, query, pending, edits, retain, accept, apply, addIntent };
}

it("does not publish a review read against an earlier pending-intention generation", async () => {
  let release!: () => void;
  const state = fixture(new Promise<void>(resolve => { release = resolve; }));
  const opening = state.recovery.open();
  expect(state.recovery.reading.value).toBe(true);
  state.addIntent(); release(); await opening;
  expect(state.recovery.rows.value).toEqual([]); expect(state.recovery.ready.value).toBe(false);
  expect(state.recovery.error.value).toContain("Intentions changed");
  expect(await state.recovery.submit()).toBe(false);
  expect(state.pending.value).toEqual(state.edits); expect(state.accept).not.toHaveBeenCalled(); expect(state.apply).not.toHaveBeenCalled();
});

it("rejects a ready review after a new failed intention arrives, preserving the entire new batch", async () => {
  const state = fixture(); await state.recovery.open();
  expect(state.recovery.ready.value).toBe(true);
  state.addIntent();
  expect(await state.recovery.submit()).toBe(false);
  expect(state.recovery.error.value).toContain("Intentions changed"); expect(state.recovery.ready.value).toBe(false);
  expect(state.pending.value).toEqual(state.edits); expect(state.retain).not.toHaveBeenCalled(); expect(state.accept).not.toHaveBeenCalled(); expect(state.apply).not.toHaveBeenCalled();
});

it("keeps intent and exposes a stale notice when the latest-query candidate refuses acceptance", async () => {
  const state = fixture(); state.accept.mockReturnValue(false); await state.recovery.open();
  expect(await state.recovery.submit()).toBe(false);
  expect(state.recovery.error.value).toContain("Intentions changed"); expect(state.recovery.ready.value).toBe(false);
  expect(state.pending.value).toEqual([state.edits[0]]); expect(state.retain).not.toHaveBeenCalled(); expect(state.apply).not.toHaveBeenCalled();
});

it.each([false, true])("does not restore an obsolete recovery after a query switch (throw=%s)", async throws => {
  const state = fixture();
  let finish!: () => void;
  state.apply.mockImplementationOnce(() => new Promise<boolean>((resolve, reject) => {
    finish = () => throws ? reject(new Error("Old query failed")) : resolve(false);
  }));
  await state.recovery.open();
  const submitted = state.recovery.submit();
  expect(state.recovery.applying.value).toBe(true);
  state.query.value = { id: "B" };
  state.retain([]);
  expect(state.recovery.opened.value).toBe(false);
  const retained = state.retain.mock.calls.length;
  finish();
  expect(await submitted).toBe(false);
  expect(state.retain).toHaveBeenCalledTimes(retained);
  expect(state.pending.value).toEqual([]);
  expect(state.recovery.rows.value).toEqual([]);
  expect(state.recovery.error.value).toBeNull();
});
