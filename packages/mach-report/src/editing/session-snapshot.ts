import type { ReportEditSessionPart } from "./session-data";
import { ReportCellEditError } from "./value";

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
  if (!(value instanceof Date) && !Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new ReportCellEditError("conflict");
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (typeof key === "symbol" || !Object.getOwnPropertyDescriptor(value, key)?.enumerable) throw new ReportCellEditError("conflict");
    if (value instanceof Date || Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) throw new ReportCellEditError("conflict");
  }
}
function collect(value: unknown, stamps: ObjectStamp[], active: Set<object>, budget: Budget, depth: number): void {
  checkBudget(budget, depth);
  if (typeof value === "function" || typeof value === "symbol") throw new ReportCellEditError("conflict");
  if (value === null || typeof value !== "object") return;
  checkObject(value);
  if (active.has(value)) throw new ReportCellEditError("conflict");
  active.add(value);
  const keys = Object.keys(value), values = keys.map((key) => ownValue(value, key));
  stamps.push({ object: value, prototype: Object.getPrototypeOf(value), keys, values,
    ...(value instanceof Date ? { date: Date.prototype.getTime.call(value) } : {}),
    ...(Array.isArray(value) ? { length: value.length } : {}) });
  for (const item of values) collect(item, stamps, active, budget, depth + 1);
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
  const stamps: ObjectStamp[] = [];
  collect(parts, stamps, new Set(), { nodes: 0 }, 0);
  return () => { try { return stamps.every(matches); } catch { return false; } };
}
function clone(value: unknown, budget: Budget, depth: number): unknown {
  checkBudget(budget, depth);
  // Strings are immutable: retain their value without copying or scanning their characters.
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(Date.prototype.getTime.call(value));
  if (Array.isArray(value)) return value.map((item) => clone(item, budget, depth + 1));
  return Object.fromEntries(Object.keys(value).map((key) => [key, clone(ownValue(value, key), budget, depth + 1)]));
}
/** Called only after the guard succeeds; depth/node bounds apply again to the owned snapshot. */
export function snapshotSessionParts(parts: readonly ReportEditSessionPart[]): ReportEditSessionPart[] {
  return clone(parts, { nodes: 0 }, 0) as ReportEditSessionPart[];
}
