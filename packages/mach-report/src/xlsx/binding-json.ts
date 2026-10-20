function isJsonScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}
export function checkedMetadata(value: unknown, depth = 0): void {
  if (isJsonScalar(value)) return;
  if (!value || typeof value !== "object" || depth > 16)
    throw new Error("绑定会话元数据只允许有限深度的普通 JSON 值");
  const proto = Object.getPrototypeOf(value);
  if (
    Array.isArray(value)
      ? proto !== Array.prototype
      : proto !== Object.prototype && proto !== null
  )
    throw new Error("绑定会话不能包含特殊对象原型");
  if (Object.getOwnPropertySymbols(value).length)
    throw new Error("绑定会话不能包含 Symbol");
  if (Array.isArray(value) && Object.keys(value).length !== value.length)
    throw new Error("绑定会话数组不能包含空位或额外属性");
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (Array.isArray(value) && key === "length") continue;
    if (
      ["__proto__", "prototype", "constructor"].includes(key) ||
      descriptor.get ||
      descriptor.set ||
      !descriptor.enumerable
    )
      throw new Error("绑定会话包含不安全元数据");
    checkedMetadata(descriptor.value, depth + 1);
  }
}
