export interface CapturedObject { object: object; keys: string[]; values: unknown[]; date?: number; length?: number }
interface Frame { stamp: CapturedObject; values: unknown[]; index: number }
function finish(frame: Frame): unknown {
  if (frame.stamp.date !== undefined) return new Date(frame.stamp.date);
  if (frame.stamp.length !== undefined) return frame.values;
  return Object.fromEntries(frame.stamp.keys.map((key, index) => [key, frame.values[index]]));
}
/** Reads only captured descriptors/scalars after the first yield, never the
 * original objects. Shared paths are expanded just like the synchronous clone. */
export function* materializeSnapshot(root: object, stamps: CapturedObject[]): Generator<void, unknown> {
  const captured = new Map<object, CapturedObject>();
  for (const stamp of stamps) { captured.set(stamp.object, stamp); yield; }
  const stack: Frame[] = [{ stamp: captured.get(root)!, values: [], index: 0 }];
  while (stack.length) {
    const current = stack[stack.length - 1]!;
    if (current.index === current.stamp.values.length) {
      const result = finish(current);
      stack.pop();
      if (!stack.length) return result;
      stack[stack.length - 1]!.values.push(result);
    } else {
      const value = current.stamp.values[current.index++];
      if (value !== null && typeof value === "object") stack.push({ stamp: captured.get(value)!, values: [], index: 0 });
      else current.values.push(value);
    }
    yield;
  }
}
