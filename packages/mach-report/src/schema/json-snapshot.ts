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
  let nodes = 0, minimumBytes = 0;
  const ancestors = new Set<object>();
  function account(bytes: number): void {
    minimumBytes += bytes;
    if (minimumBytes > options.maxBytes) throw options.error("budget", "快照超过字节预算");
  }
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > maxNodes || depth > 64) throw options.error("budget", "快照节点或深度超过预算");
    if (nodes % 1024 === 0) options.check?.();
    if (typeof value === "string") { account(value.length + 2); return value; }
    if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) { account(String(value).length); return value; }
    if (!value || typeof value !== "object" || ancestors.has(value)) throw options.error("input", "快照应为无循环的有限 JSON 值");
    return container(value, depth);
  }
  function container(value: object, depth: number): unknown {
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array) || Object.getOwnPropertySymbols(value).length) throw options.error("input", "快照应为普通 JSON 对象");
    const keys = Object.getOwnPropertyNames(value).filter(key => !(array && key === "length"));
    if (array && (keys.length !== value.length || keys.some((key, index) => key !== String(index)))) throw options.error("input", "快照数组应为连续数组");
    ancestors.add(value); account(2);
    const result: Record<string, unknown> = Object.create(null);
    let entries = 0;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (descriptor.get || descriptor.set || !descriptor.enumerable || ["__proto__", "constructor", "prototype"].includes(key)) throw options.error("input", "快照不允许访问器或危险键");
      if (descriptor.value === undefined && !array) continue;
      account((entries++ ? 1 : 0) + (array ? 0 : key.length + 3));
      result[key] = visit(descriptor.value === undefined ? null : descriptor.value, depth + 1);
    }
    ancestors.delete(value);
    return array ? keys.map(key => result[key]) : result;
  }
  options.check?.();
  const text = JSON.stringify(visit(input, 0));
  if (new TextEncoder().encode(text).byteLength > options.maxBytes) throw options.error("budget", "快照超过字节预算");
  return JSON.parse(text) as T;
}
