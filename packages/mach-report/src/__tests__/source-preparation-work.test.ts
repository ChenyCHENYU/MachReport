// @vitest-environment node
import { describe, expect, it } from "vitest";
import { snapshotLayoutPart, snapshotLayoutPartAsync } from "../editing/session-snapshot";
import { computeDataset, iterateComputedDataset } from "../processing/computed";
import { drainCooperatively } from "../processing/cooperative";
import { iterateDatasetValidation, validateDatasetRows } from "../schema/dataset";
import type { DatasetContract } from "../schema/dataset";

async function sample<T>(run: () => Promise<T>): Promise<{ value: T; initialMs: number; continuationMaxMs: number; heartbeats: number }> {
  let previous = performance.now();
  const gaps: number[] = [];
  const heartbeat = setInterval(() => { const now = performance.now(); gaps.push(now - previous); previous = now; }, 1);
  try {
    const started = performance.now(), pending = run(), initialMs = performance.now() - started;
    const value = await pending;
    return { value, initialMs, continuationMaxMs: Math.max(0, ...gaps.slice(1)), heartbeats: gaps.length };
  } finally { clearInterval(heartbeat); }
}
function syncSample<T>(run: () => T): { value: T; blockingMs: number } {
  const started = performance.now(), value = run();
  return { value, blockingMs: performance.now() - started };
}

describe("owned preparation deterministic work", () => {
  it("shares the exact sync/generator computation including dependent aggregate passes", async () => {
    const rows = Array.from({ length: 1200 }, (_, id) => ({ id, group: id % 2, value: id }));
    const options = { fields: [
      { field: "next", expression: { op: "add" as const, args: [{ field: "value" }, { value: 1 }] } },
      { field: "groupTotal", scope: "group" as const, groupBy: ["group"], expression: { aggregate: "sum" as const, field: "next" } }
    ] };
    const expected = computeDataset(rows, options), work = iterateComputedDataset(rows, options);
    let checkpoints = 0, item = work.next();
    while (!item.done) { checkpoints++; item = work.next(); }
    expect(checkpoints).toBe(rows.length * 3);
    expect(item.value).toEqual(expected);
    expect(iterateComputedDataset(rows, options, false).next()).toEqual({ done: true, value: expected });
    expect(await drainCooperatively(iterateComputedDataset(rows, options))).toEqual(expected);
  });

  it("disables checkpoints only for synchronous contract validation without changing issue/key order", async () => {
    const input = [{ id: "A", value: 1 }, { id: "B", value: -1 }, { id: "A", value: 3 }];
    const contract: DatasetContract = { rowKey: "id", fields: [{ field: "id", type: "text", required: true }, { field: "value", type: "number", min: 0 }] };
    const options = { maxIssues: 2, path: "$.records" }, expected = validateDatasetRows(input, contract, options);
    expect(expected.issues.map(issue => [issue.code, issue.path])).toEqual([["range", "$.records[1].value"], ["row-key", "$.records[2].id"]]);
    expect(iterateDatasetValidation(input, contract, options, false).next()).toEqual({ done: true, value: expected });
    expect(await drainCooperatively(iterateDatasetValidation(input, contract, options))).toEqual(expected);
    expect(() => iterateDatasetValidation(input, { fields: [] }, {}, false).next()).toThrow(/fields/);
    expect(() => iterateComputedDataset([null as unknown as Record<string, unknown>], { fields: [] }, false).next()).toThrow(/第 1 行/);
  });

  it("records real CPU boundaries while timers run during snapshot, validation and pure preparation", async () => {
    const rows = Array.from({ length: 48000 }, (_, id) => Object.fromEntries(Array.from({ length: 10 }, (_, column) => [`f${column}`, id + column])));
    const part = { template: { pages: [] }, datasets: { rows } };
    const syncSnapshot = syncSample(() => snapshotLayoutPart(part)), asyncSnapshot = await sample(() => snapshotLayoutPartAsync(part));
    expect(asyncSnapshot.value).toEqual(syncSnapshot.value);
    expect(asyncSnapshot.heartbeats).toBeGreaterThan(1);
    const contract: DatasetContract = { fields: Array.from({ length: 10 }, (_, field) => ({ field: `f${field}`, type: "number" as const })) };
    const syncValidation = syncSample(() => validateDatasetRows(rows, contract)), asyncValidation = await sample(() => drainCooperatively(iterateDatasetValidation(rows, contract)));
    expect(asyncValidation.value).toEqual(syncValidation.value);
    expect(asyncValidation.heartbeats).toBeGreaterThan(1);
    const options = { fields: [{ field: "computed", expression: { field: "f1" } }] };
    const syncComputed = syncSample(() => computeDataset(rows, options)), asyncComputed = await sample(() => drainCooperatively(iterateComputedDataset(rows, options)));
    expect(asyncComputed.value).toEqual(syncComputed.value);
    expect(asyncComputed.heartbeats).toBeGreaterThan(1);
    const metric = <T>(before: { blockingMs: number }, after: { initialMs: number; continuationMaxMs: number; heartbeats: number; value: T }) => ({ syncBlockingMs: +before.blockingMs.toFixed(2), initialCaptureOrSliceMs: +after.initialMs.toFixed(2), continuationMaxMs: +after.continuationMaxMs.toFixed(2), heartbeats: after.heartbeats });
    console.info("owned-preparation-cpu", JSON.stringify({ rows: rows.length, snapshot: metric(syncSnapshot, asyncSnapshot), validation: metric(syncValidation, asyncValidation), computed: metric(syncComputed, asyncComputed) }));
  });
});
