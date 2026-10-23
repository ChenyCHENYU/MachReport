/** Internal bounded JSON snapshot shared by geometry and output boundaries. */
export function snapshotReportJson<T>(input: T, options: {
  maxBytes: number;
  error(code: "input" | "budget", message: string): Error;
  check?(): void;
}): T {
  let nodes = 0, characters = 0;
  const ancestors = new Set<object>();
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > 1_000_000 || depth > 64) throw options.error("budget", "快照节点或深度超过预算");
    if (nodes % 1024 === 0) options.check?.();
    if (typeof value === "string") { characters += value.length; if (characters > options.maxBytes) throw options.error("budget", "快照文本超过预算"); }
    if (value === null || ["string", "boolean"].includes(typeof value) || typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object" || ancestors.has(value)) throw options.error("input", "快照应为无循环的有限 JSON 值");
    return container(value, depth);
  }
  function container(value: object, depth: number): unknown {
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array) || Object.getOwnPropertySymbols(value).length) throw options.error("input", "快照应为普通 JSON 对象");
    const keys = Object.getOwnPropertyNames(value).filter(key => !(array && key === "length"));
    if (array && (keys.length !== value.length || keys.some((key, index) => key !== String(index)))) throw options.error("input", "快照数组应为连续数组");
    ancestors.add(value);
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      characters += key.length;
      if (characters > options.maxBytes) throw options.error("budget", "快照文本超过预算");
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (descriptor.get || descriptor.set || !descriptor.enumerable || ["__proto__", "constructor", "prototype"].includes(key)) throw options.error("input", "快照不允许访问器或危险键");
      if (descriptor.value !== undefined) result[key] = visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
    return array ? keys.map(key => result[key]) : result;
  }
  options.check?.();
  const text = JSON.stringify(visit(input, 0));
  if (new TextEncoder().encode(text).byteLength > options.maxBytes) throw options.error("budget", "快照超过字节预算");
  return JSON.parse(text) as T;
}
