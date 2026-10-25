import { ownParamArray } from "./param-safe-array";
import type { ReportParamDef, ReportParamTreeOption } from "../layout/paginate";

export type ReportNumberRange = readonly [number, number];
export const PARAM_SELECTION_LIMIT = 100;
export const PARAM_PATH_LIMIT = 16;
export const PARAM_WIRE_MAX_CODE_UNITS = 104_857;

/** Canonical JSON preserves commas, slashes, Unicode and leading zeros without CSV guessing. */
function parseStringArray(value: unknown, limit: number, unique: boolean): string[] | undefined {
  if (typeof value === "string") {
    if (value.length > PARAM_WIRE_MAX_CODE_UNITS) return undefined;
    try { value = JSON.parse(value) as unknown; } catch { return undefined; }
  }
  const slots = ownParamArray(value, limit); if (!slots) return undefined;
  const result: string[] = []; let wireLength = 2;
  for (const item of slots) {
    if (typeof item !== "string" || !item.trim() || item.length > 1024 || unique && result.includes(item)) return undefined;
    wireLength += JSON.stringify(item).length + (result.length ? 1 : 0);
    if (wireLength > PARAM_WIRE_MAX_CODE_UNITS) return undefined;
    result.push(item);
  }
  return result;
}
export function parseReportParamSelection(value: unknown): string[] | undefined { return parseStringArray(value, PARAM_SELECTION_LIMIT, true); }
export function parseReportCascaderPath(value: unknown): string[] | undefined { return parseStringArray(value, PARAM_PATH_LIMIT, false); }
export function formatReportCascaderPath(value: readonly string[]): string {
  const parsed = parseReportCascaderPath(value);
  if (!parsed) throw new TypeError("Invalid report cascader path");
  return JSON.stringify(parsed);
}
export function formatReportParamSelection(value: readonly string[]): string {
  const parsed = parseReportParamSelection(value);
  if (!parsed) throw new TypeError("Invalid report parameter selection");
  return JSON.stringify(parsed);
}
export function parseReportNumberRange(value: unknown): ReportNumberRange | undefined {
  if (typeof value === "string") {
    if (value.length > 2048) return undefined;
    try { value = JSON.parse(value) as unknown; } catch { return undefined; }
  }
  const slots = ownParamArray(value, 2); if (!slots || slots.length !== 2) return undefined;
  const start = slots[0], end = slots[1];
  return typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end) && start <= end ? [start, end] : undefined;
}
export function formatReportNumberRange(value: ReportNumberRange): string {
  const parsed = parseReportNumberRange(value);
  if (!parsed) throw new TypeError("Invalid report number range");
  return JSON.stringify(parsed);
}
export function isCompoundParam(def: ReportParamDef): boolean { return ["multiSelect", "cascader", "numberRange"].includes(def.type ?? ""); }
export function compoundParamValue(def: ReportParamDef, raw: unknown): string[] | ReportNumberRange | undefined {
  return def.type === "numberRange" ? parseReportNumberRange(raw) : def.type === "cascader" ? parseReportCascaderPath(raw) : parseReportParamSelection(raw);
}

/** Bounded iterative tree validation prevents cycles, ambiguous paths and stack overflow. */
export function validReportParamOptions(value: unknown, tree: boolean, allowEmpty = false): value is ReportParamTreeOption[] {
  const initial = ownParamArray(value, 1000); if (!initial) return false;
  const queue = [{ items: initial, depth: 1 }], visited = new Set<unknown>();
  let count = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { items, depth } = queue[cursor]!;
    if (depth > PARAM_PATH_LIMIT) return false;
    const siblings = new Set<string>();
    for (const item of items) {
      const option = readOption(item, allowEmpty);
      if (++count > 1000 || !option || visited.has(item) || siblings.has(option.value)) return false;
      visited.add(item); siblings.add(option.value);
      if (option.children !== undefined) {
        const children = ownParamArray(option.children, 1000);
        if (!tree || !children) return false;
        if (children.length) queue.push({ items: children, depth: depth + 1 });
      }
    }
  }
  return true;
}
export function snapshotReportParamOptions(options: readonly ReportParamTreeOption[]): ReportParamTreeOption[] {
  return options.map(option => ({ value: option.value, label: option.label, ...(option.children ? { children: snapshotReportParamOptions(option.children) } : {}) }));
}
function readOption(item: unknown, allowEmpty: boolean): ReportParamTreeOption | undefined {
  if (!item || typeof item !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(item);
  if (Object.values(descriptors).some(descriptor => !Object.prototype.hasOwnProperty.call(descriptor, "value"))) return undefined;
  const value: unknown = descriptors.value?.value, label: unknown = descriptors.label?.value;
  if (typeof value !== "string" || !allowEmpty && !value.trim() || value.length > 1024 || typeof label !== "string" || label.length > 1024) return undefined;
  return { value, label, ...(descriptors.children ? { children: descriptors.children.value as ReportParamTreeOption[] } : {}) };
}
export function validCascaderPath(options: readonly ReportParamTreeOption[], path: readonly string[]): boolean {
  let siblings = options;
  for (const [index, part] of path.entries()) {
    const option = siblings.find(item => item.value === part);
    if (!option) return false;
    siblings = option.children ?? [];
    if (index === path.length - 1) return siblings.length === 0;
  }
  return false;
}
