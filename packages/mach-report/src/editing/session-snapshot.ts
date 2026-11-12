import type { ReportEditSessionPart } from "./session-data";
import type { RenderPlan } from "../schema/render-plan";
import { ReportCellEditError } from "./value";
import { registerComputedDataset } from "../processing/computation-workspace";
import { checkCooperativeAbort, drainCooperatively } from "../processing/cooperative";
import { materializeSnapshot } from "./snapshot-materialization";

interface Budget { nodes: number }
interface ObjectStamp { object: object; prototype: object | null; keys: string[]; values: unknown[]; date?: number; length?: number }
function checkBudget(budget: Budget, depth: number): void {
  if (++budget.nodes > 1_000_000 || depth > 128) throw new ReportCellEditError("limit");
}
function ownValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.get || descriptor.set) throw new ReportCellEditError("conflict");
  return descriptor.value;
}
function checkObject(value: object): void {
  if (Object.getOwnPropertyDescriptor(value, "toJSON")) throw new ReportCellEditError("conflict");
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value) && (prototype !== Array.prototype || Object.keys(value).length !== value.length)) throw new ReportCellEditError("conflict");
  if (!(value instanceof Date) && !Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new ReportCellEditError("conflict");
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (typeof key === "symbol" || !Object.getOwnPropertyDescriptor(value, key)?.enumerable) throw new ReportCellEditError("conflict");
    if (value instanceof Date || Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) throw new ReportCellEditError("conflict");
  }
}
function capturedPrototype(object: object, array: boolean, date: boolean): object | null {
  const prototype = Object.getPrototypeOf(object);
  if (array && prototype !== Array.prototype || !array && !date && prototype !== Object.prototype && prototype !== null) throw new ReportCellEditError("conflict");
  return prototype;
}
function captureObject(object: object): ObjectStamp {
  const array = Array.isArray(object), date = object instanceof Date, prototype = capturedPrototype(object, array, date);
  const keys: string[] = [], values: unknown[] = [];
  for (const key of Reflect.ownKeys(object)) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
    if (typeof key === "symbol" || key === "toJSON" || date || !descriptor.enumerable || descriptor.get || descriptor.set) throw new ReportCellEditError("conflict");
    if (array && !/^(0|[1-9]\d*)$/.test(key)) throw new ReportCellEditError("conflict");
    keys.push(key); values.push(descriptor.value);
  }
  if (array && keys.length !== object.length) throw new ReportCellEditError("conflict");
  return { object, prototype, keys, values, ...(date ? { date: Date.prototype.getTime.call(object) } : {}), ...(array ? { length: object.length } : {}) };
}
function collect(value: unknown, stamps: ObjectStamp[], active: Set<object>, budget: Budget, depth: number, seen?: Set<object>): void {
  checkBudget(budget, depth);
  if (typeof value === "function" || typeof value === "symbol") throw new ReportCellEditError("conflict");
  if (value === null || typeof value !== "object") return;
  if (active.has(value)) throw new ReportCellEditError("conflict");
  if (seen?.has(value)) return;
  seen?.add(value);
  active.add(value);
  const stamp = captureObject(value);
  stamps.push(stamp);
  for (const item of stamp.values) collect(item, stamps, active, budget, depth + 1, seen);
  active.delete(value);
}
function matches(stamp: ObjectStamp): boolean {
  const { object, keys, values } = stamp;
  checkObject(object);
  if (Object.getPrototypeOf(object) !== stamp.prototype || Object.getOwnPropertyDescriptor(object, "toJSON")) return false;
  if (stamp.date !== undefined && !Object.is(Date.prototype.getTime.call(object), stamp.date)) return false;
  if (stamp.length !== undefined && (object as unknown[]).length !== stamp.length) return false;
  const currentKeys = Object.keys(object);
  return currentKeys.length === keys.length && keys.every((key, index) => currentKeys[index] === key && Object.is(ownValue(object, key), values[index]));
}
/** Exact structural/primitive comparison avoids hashing every byte of unused large strings. */
export function captureSessionGuard(parts: readonly ReportEditSessionPart[]): () => boolean {
  return captureStructureGuard(parts);
}
/** Internal exact fence for structurally shared edit candidates. */
export function capturePlanGuard(plan: RenderPlan): () => boolean {
  return captureStructureGuard(plan, new Set());
}
function captureStructureGuard(value: unknown, seen?: Set<object>): () => boolean {
  const stamps: ObjectStamp[] = [];
  collect(value, stamps, new Set(), { nodes: 0 }, 0, seen);
  return () => { try { return stamps.every(matches); } catch { return false; } };
}
function clone(value: unknown, budget: Budget, depth: number, validate = false, copies?: WeakMap<object, object>): unknown {
  checkBudget(budget, depth);
  if (validate) {
    if (typeof value === "function" || typeof value === "symbol") throw new ReportCellEditError("conflict");
    if (value !== null && typeof value === "object") checkObject(value);
  }
  // Strings are immutable: retain their value without copying or scanning their characters.
  if (value === null || typeof value !== "object") return value;
  const retained = copies?.get(value);
  if (retained) return retained;
  if (value instanceof Date) { const result = new Date(Date.prototype.getTime.call(value)); copies?.set(value, result); return result; }
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    copies?.set(value, result);
    for (let index = 0; index < value.length; index++) result[index] = clone(ownValue(value, String(index)), budget, depth + 1, validate, copies);
    return result;
  }
  return cloneRecord(value, budget, depth, validate, copies);
}
function cloneRecord(value: object, budget: Budget, depth: number, validate: boolean, copies?: WeakMap<object, object>): object {
  if (!copies) return Object.fromEntries(Object.keys(value).map((key) => [key, clone(ownValue(value, key), budget, depth + 1, validate)]));
  const result: Record<string, unknown> = {};
  copies.set(value, result);
  for (const key of Object.keys(value)) Object.defineProperty(result, key, { value: clone(ownValue(value, key), budget, depth + 1, validate, copies), enumerable: true, writable: true, configurable: true });
  return result;
}
/** Public candidate previews are detached, while repeated styles/geometry keep
 * their sharing inside the copy. No source strings are serialized or rescanned. */
export function snapshotCandidatePlan(plan: RenderPlan): RenderPlan {
  return clone(plan, { nodes: 0 }, 0, true, new WeakMap()) as RenderPlan;
}
/** Layout owns its plain/Date/scalar input before yielding to host events. The
 * descriptor checks share edit-session policy and never invoke custom getters. */
export function snapshotLayoutPart(part: ReportEditSessionPart): ReportEditSessionPart {
  return clone(part, { nodes: 0 }, 0, true) as ReportEditSessionPart;
}
/** Descriptor capture is deliberately synchronous: host events cannot produce a
 * mixed query snapshot. Allocation/materialization then yields on captured data. */
export async function snapshotLayoutPartAsync(part: ReportEditSessionPart, signal?: AbortSignal): Promise<ReportEditSessionPart> {
  return snapshotOwnedValueAsync(part, signal);
}
/** Internal capture also owns declarative validation metadata across row slices. */
export async function snapshotOwnedValueAsync<T extends object>(value: T, signal?: AbortSignal): Promise<T> {
  checkCooperativeAbort(signal);
  return drainCooperatively(captureOwnedValue(value), signal);
}
/** Capture may reject synchronously so exotic readonly callers can retain their
 * uninterrupted validate/render boundary instead of inserting a microtask. */
export function captureOwnedValue<T extends object>(value: T): Generator<void, T> {
  const stamps: ObjectStamp[] = [];
  collect(value, stamps, new Set(), { nodes: 0 }, 0);
  return materializeSnapshot(value, stamps) as Generator<void, T>;
}
/** Called only after the guard succeeds; depth/node bounds apply again to the owned snapshot. */
export function snapshotSessionParts(parts: readonly ReportEditSessionPart[]): ReportEditSessionPart[] {
  const snapshot = clone(parts, { nodes: 0 }, 0) as ReportEditSessionPart[];
  for (const part of snapshot) for (const rows of Object.values(part.datasets)) registerComputedDataset(rows);
  return snapshot;
}
