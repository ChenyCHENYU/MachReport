// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { captureSessionGuard, snapshotSessionParts } from "../editing/session-snapshot";
import { createTableTemplate } from "../builder/table-template";

const template = () => createTableTemplate({ columns: [{ field: "id", header: "ID" }] });
describe("private edit snapshot array ownership", () => {
  it("rejects Array subclasses and never invokes their map/species hooks", () => {
    const map = vi.fn(), species = vi.fn();
    class ExternalRows extends Array<Record<string, unknown>> {
      static override get [Symbol.species]() { species(); return Array; }
    }
    const rows = new ExternalRows({ id: "1" });
    Object.defineProperty(ExternalRows.prototype, "map", { value() { map(); return this; } });
    expect(() => captureSessionGuard([{ template: template(), datasets: { detail: rows } }])).toThrow("conflict");
    expect(map).not.toHaveBeenCalled(); expect(species).not.toHaveBeenCalled();
  });
  it("rejects a replaced array prototype and sparse arrays before cloning", () => {
    const rows = [{ id: "1" }];
    Object.setPrototypeOf(rows, { ...Array.prototype, map() { return this; } });
    expect(() => captureSessionGuard([{ template: template(), datasets: { detail: rows } }])).toThrow("conflict");
    expect(() => captureSessionGuard([{ template: template(), datasets: { detail: new Array(2) } }])).toThrow("conflict");
  });
  it("detaches dense own arrays and row objects without invoking a source array map", () => {
    const rows = [{ id: "1", nested: [0, false, null] }], parts = [{ template: template(), datasets: { detail: rows } }];
    expect(captureSessionGuard(parts)()).toBe(true);
    const copied = snapshotSessionParts(parts);
    expect(copied[0]!.datasets.detail).not.toBe(rows);
    expect(copied[0]!.datasets.detail![0]).not.toBe(rows[0]);
    rows[0]!.id = "external"; rows[0]!.nested[0] = 99;
    expect(copied[0]!.datasets.detail![0]).toEqual({ id: "1", nested: [0, false, null] });
  });
});
