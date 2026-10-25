/** Capture bounded own slots before chart code uses array iteration or methods. */
export function chartArray<T>(value: readonly T[], maximum: number, label: string): T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) throw new TypeError(`${label}应为有界普通数组`);
  if (Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError(`${label}不支持自定义数组方法或迭代器`);
  const result: T[] = [];
  for (let index = 0; index < value.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(value, String(index));
    if (!slot || !Object.prototype.hasOwnProperty.call(slot, "value")) throw new TypeError(`${label}不支持空洞或访问器`);
    result.push(slot.value as T);
  }
  return result;
}
