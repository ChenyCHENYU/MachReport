/** Snapshot bounded own data slots without invoking iterators, index getters or array methods. */
export function ownParamArray(value: unknown, limit: number): unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const length: unknown = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > limit) return undefined;
  // Named methods, symbols and sparse/accessor slots cannot change later consumers' semantics.
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) return undefined;
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) return undefined;
    result.push(descriptor.value);
  }
  return result;
}
