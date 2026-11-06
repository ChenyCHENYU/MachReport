// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { effectScope, shallowRef } from "vue";
import { summarizeReportCellEdits, type RenderPlan, type ReportCellEdit } from "@agile-team/mach-report";
import { createBoundedEditHistory, editHistoryLimits, mergeEditDifferences } from "../composables/edit-history-state";
import { useEditHistory } from "../composables/useEditHistory";
import type { ReportEditingOptions } from "../editing";

const address = { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 };
function edit(previousValue: number, value: number, rowKey = "R1"): ReportCellEdit {
  return { address, previousValue, value, previousText: String(previousValue), text: String(value), source: { datasetId: "detail", rowKey, field: "qty" } };
}

describe("bounded undo and incremental net differences", () => {
  it("matches the existing summary after repeated changes, reversals and identity changes", () => {
    const events: ReportCellEdit[] = [];
    const net = new Map<string, ReportCellEdit>();
    const values = new Map<string, number>();
    for (let index = 0; index < 1000; index++) {
      const key = `R${index % 17}`;
      const previous = values.get(key) ?? 0;
      const value = index % 5 ? index : 0;
      const next = edit(previous, value, key);
      next.source = { ...next.source!, revision: index };
      events.push(next); values.set(key, value);
      mergeEditDifferences(net, [next]);
    }
    expect([...net.values()]).toEqual(summarizeReportCellEdits(events));
    expect([...net.values()].every(item => item.previousValue === 0)).toBe(true);
  });

  it("bounds combined undo/redo storage, drops a redo branch, and resets its notice", () => {
    const history = createBoundedEditHistory();
    const limits = editHistoryLimits({ maxSteps: 2, maxBytes: 10000 });
    history.append([edit(0, 1)], limits);
    history.append([edit(1, 2)], limits);
    history.append([edit(2, 3)], limits);
    expect(history.limited).toBe(true);
    expect(history.undo?.[0]?.value).toBe(3);
    history.completeUndo();
    expect(history.redo?.[0]?.value).toBe(3);
    history.completeRedo();
    history.completeUndo();
    history.append([edit(2, 4)], limits);
    expect(history.redo).toBeUndefined();
    history.completeUndo(); history.completeUndo();
    expect(history.undo).toBeUndefined();
    history.clear();
    expect(history.redo).toBeUndefined();
    expect(history.limited).toBe(false);
  });

  it("does not retain an oversized or disabled transaction and rejects invalid limits", () => {
    const history = createBoundedEditHistory();
    history.append([edit(0, 1)], editHistoryLimits({ maxBytes: 1 }));
    expect(history.undo).toBeUndefined();
    expect(history.limited).toBe(true);
    history.append([edit(1, 2)], editHistoryLimits({ maxSteps: 0 }));
    expect(history.undo).toBeUndefined();
    expect(() => editHistoryLimits({ maxSteps: -1 })).toThrow(RangeError);
    expect(() => editHistoryLimits({ maxBytes: Infinity })).toThrow(RangeError);
    expect(editHistoryLimits()).toEqual({ maxSteps: 100, maxBytes: 8 * 1024 * 1024 });
  });

  it("shrinks past and future immediately without making the next redo skip a transaction", () => {
    const history = createBoundedEditHistory();
    for (let value = 1; value <= 4; value++) history.append([edit(value - 1, value)], editHistoryLimits());
    history.completeUndo(); history.completeUndo();
    history.resize(editHistoryLimits({ maxSteps: 1 }));
    expect(history.undo).toBeUndefined();
    expect(history.redo?.[0]?.value).toBe(3);
    history.completeRedo();
    expect(history.undo?.[0]?.value).toBe(3);
    expect(history.redo).toBeUndefined();
    history.resize(editHistoryLimits({ maxBytes: 0 }));
    expect(history.undo).toBeUndefined();
    expect(history.limited).toBe(true);
  });

  it("retains every event and the original value across 1000 edits with bounded undo", async () => {
    const plan = shallowRef<RenderPlan | null>({ schemaVersion: "history", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 100, heightMm: 10, grid: { cells: [[{ value: 0, text: "0", valueType: "number" }]] } }] }] });
    const options = shallowRef<boolean | ReportEditingOptions>({ history: { maxSteps: 3 } });
    const scope = effectScope();
    const history = scope.run(() => useEditHistory({ plan, options, blocked: () => false, onChange: vi.fn(), onError: vi.fn() }))!;
    try {
      for (let value = 1; value <= 1000; value++) expect(await history.apply([{ address, value }])).toBe(true);
      expect(history.changes.value).toHaveLength(1000);
      expect(history.differences.value).toMatchObject([{ previousValue: 0, value: 1000 }]);
      expect(history.localDifferences.value).toHaveLength(1);
      expect(history.historyLimited.value).toBe(true);
      for (let count = 0; count < 3; count++) expect(await history.undo()).toBe(true);
      expect(await history.undo()).toBe(false);
      expect(history.differences.value[0]?.value).toBe(997);
      expect(await history.redo()).toBe(true);
      expect(await history.restore()).toBe(true);
      expect(history.differences.value).toEqual([]);
      expect(history.hasLocalDrafts.value).toBe(false);
      expect(history.changes.value).toHaveLength(1005);
      expect(history.canUndo.value).toBe(false);
    } finally { scope.stop(); }
  });

  it("validates history configuration before a save and keeps all drafts when undo is disabled", async () => {
    const plan = shallowRef<RenderPlan | null>({ schemaVersion: "history", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 100, heightMm: 10, grid: { cells: [[{ value: 0, text: "0", valueType: "number" }]] } }] }] });
    const saveBatch = vi.fn();
    const options = shallowRef<boolean | ReportEditingOptions>({ saveBatch, history: { maxBytes: -1 } });
    const onError = vi.fn();
    const scope = effectScope();
    const history = scope.run(() => useEditHistory({ plan, options, blocked: () => false, onChange: vi.fn(), onError }))!;
    try {
      expect(await history.apply([{ address, value: 1 }])).toBe(false);
      expect(saveBatch).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledOnce();
      options.value = { history: { maxSteps: 0 } };
      expect(await history.apply([{ address, value: 2 }])).toBe(true);
      expect(history.canUndo.value).toBe(false);
      expect(history.hasLocalDrafts.value).toBe(true);
      expect(history.differences.value).toMatchObject([{ previousValue: 0, value: 2 }]);
      expect(await history.restore()).toBe(true);
      expect(history.changes.value).toHaveLength(2);
    } finally { scope.stop(); }
  });

  it("reactively disables retained undo without clearing current changes or local drafts", async () => {
    const plan = shallowRef<RenderPlan | null>({ schemaVersion: "history", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 100, heightMm: 10, grid: { cells: [[{ value: 0, text: "0", valueType: "number" }]] } }] }] });
    const options = shallowRef<boolean | ReportEditingOptions>(true);
    const scope = effectScope();
    const history = scope.run(() => useEditHistory({ plan, options, blocked: () => false, onChange: vi.fn(), onError: vi.fn() }))!;
    try {
      expect(await history.apply([{ address, value: 3 }])).toBe(true);
      expect(history.canUndo.value).toBe(true);
      options.value = { history: { maxSteps: 0 } };
      expect(history.canUndo.value).toBe(false);
      expect(await history.undo()).toBe(false);
      expect(history.changes.value).toHaveLength(1);
      expect(history.hasLocalDrafts.value).toBe(true);
      expect(history.differences.value[0]).toMatchObject({ previousValue: 0, value: 3 });
      expect(await history.restore()).toBe(true);
    } finally { scope.stop(); }
  });
});
