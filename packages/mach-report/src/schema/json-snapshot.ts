const SHORT_ESCAPES = new Set([8, 9, 10, 12, 13]);
function containerShape(value: object, error: (code: "input" | "budget", message: string) => Error): { array: boolean; keys: string[] } {
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array) || Object.getOwnPropertySymbols(value).length) throw error("input", "快照应为普通 JSON 对象");
  const keys = Object.getOwnPropertyNames(value).filter(key => !(array && key === "length"));
  if (array && (keys.length !== value.length || keys.some((key, index) => key !== String(index)))) throw error("input", "快照数组应为连续数组");
  return { array, keys };
}
/** Count the exact JSON UTF-8 representation, including lone-surrogate escaping. */
function jsonStringBytes(value: string): number {
  if (/^[\u0020-\u007e]*$/.test(value) && !/["\\]/.test(value)) return value.length + 2;
  let bytes = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32) bytes += SHORT_ESCAPES.has(code) ? 2 : 6;
    else if (code === 34 || code === 92) bytes += 2;
    else if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdfff) {
      const next = value.charCodeAt(index + 1);
      if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index++; }
      else bytes += 6;
    } else bytes += 3;
  }
  return bytes;
}

/** Internal bounded JSON snapshot shared by geometry and output boundaries. */
export function snapshotReportJson<T>(input: T, options: {
  maxBytes: number;
  /** Domain-specific bound; generic snapshots retain the independent one-million value-node guard. */
  maxNodes?: number;
  error(code: "input" | "budget", message: string): Error;
  check?(): void;
}): T {
  const maxNodes = options.maxNodes ?? 1_000_000;
  if (![options.maxBytes, maxNodes].every(value => Number.isSafeInteger(value) && value > 0)) throw options.error("budget", "快照预算应为正安全整数");
  let nodes = 0, usedBytes = 0;
  const ancestors = new Set<object>();
  const stringSizes = new Map<string, number>();
  function stringBytes(value: string): number {
    if (value.length + 2 > options.maxBytes - usedBytes) throw options.error("budget", "快照超过字节预算");
    const cached = stringSizes.get(value);
    if (cached !== undefined) return cached;
    const bytes = jsonStringBytes(value);
    if (value.length <= 256 && stringSizes.size < 4096) stringSizes.set(value, bytes);
    return bytes;
  }
  function account(bytes: number): void {
    usedBytes += bytes;
    if (usedBytes > options.maxBytes) throw options.error("budget", "快照超过字节预算");
  }
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > maxNodes || depth > 64) throw options.error("budget", "快照节点或深度超过预算");
    if (nodes % 1024 === 0) options.check?.();
    if (typeof value === "string") { account(stringBytes(value)); return value; }
    if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) { account(String(value).length); return typeof value === "number" && Object.is(value, -0) ? 0 : value; }
    if (!value || typeof value !== "object" || ancestors.has(value)) throw options.error("input", "快照应为无循环的有限 JSON 值");
    return container(value, depth);
  }
  function container(value: object, depth: number): unknown {
    const { array, keys } = containerShape(value, options.error);
    ancestors.add(value); account(2);
    const result: Record<string, unknown> | unknown[] = array ? [] : {};
    let entries = 0;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (descriptor.get || descriptor.set || !descriptor.enumerable || ["__proto__", "constructor", "prototype"].includes(key)) throw options.error("input", "快照不允许访问器或危险键");
      if (descriptor.value === undefined && !array) continue;
      account((entries++ ? 1 : 0) + (array ? 0 : stringBytes(key) + 1));
      const item = visit(descriptor.value === undefined ? null : descriptor.value, depth + 1);
      if (key in result) Object.defineProperty(result, key, { value: item, enumerable: true, configurable: true, writable: true });
      else (result as Record<string, unknown>)[key] = item;
    }
    ancestors.delete(value);
    return result;
  }
  options.check?.();
  const snapshot = visit(input, 0) as T;
  options.check?.();
  return snapshot;
}
