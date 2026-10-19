// @vitest-environment node
import { describe, expect, it } from "vitest";
import { useTemplateHistory } from "../useTemplateHistory";

describe("bounded designer history", () => {
  it("prunes oldest frames by memory as well as count, and discards redo on a new branch", () => {
    const history = useTemplateHistory("one", { entries: 3, bytes: 20 });
    history.record("two"); history.record("three");
    expect(history.move(-1)).toBe("two"); expect(history.move(-1)).toBeUndefined();
    history.record("new"); expect(history.canRedo.value).toBe(false);
    history.record("a frame larger than the entire budget");
    expect(history.canUndo.value).toBe(false); expect(history.current.value).toContain("larger");
    history.reset("saved"); expect(history.canUndo.value).toBe(false); expect(history.canRedo.value).toBe(false);
  });
  it("keeps a large document with small edits as bounded deltas and restores branches exactly", () => {
    const prefix = "a".repeat(500_000), suffix = "尾部😀".repeat(1000);
    const values = Array.from({ length: 50 }, (_, index) => `${prefix}${index}${suffix}`);
    const history = useTemplateHistory(values[0]!);
    values.slice(1).forEach((item) => history.record(item));
    expect(history.retainedBytes.value).toBeLessThan(4_000_000);
    for (let index = values.length - 2; index >= 0; index--) expect(history.move(-1)).toBe(values[index]);
    for (let index = 1; index < values.length; index++) expect(history.move(1)).toBe(values[index]);
    history.move(-1); history.record(`${prefix}invalid JSON {${suffix}`);
    expect(history.canRedo.value).toBe(false);
    expect(history.move(-1)).toBe(values.at(-2));
  });

  it("promotes the retained baseline when pruning deltas and validates budgets", () => {
    const history = useTemplateHistory("a".repeat(1000), { entries: 3, bytes: 10_000 });
    for (let index = 0; index < 12; index++) history.record("a".repeat(999) + index);
    expect(history.move(-1)).toBe("a".repeat(999) + 10);
    expect(history.move(-1)).toBe("a".repeat(999) + 9);
    expect(history.move(-1)).toBeUndefined();
    expect(() => useTemplateHistory("", { entries: 0, bytes: 1 })).toThrow(RangeError);
  });
});
