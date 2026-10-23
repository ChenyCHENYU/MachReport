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
  it("retains independent before/after navigation per operation without making navigation an edit", () => {
    const history = useTemplateHistory("initial", { entries: 3, bytes: 1000 });
    history.record("front", { pageIndex: 0, componentIndex: 0 });
    history.annotate({ pageIndex: 1 });
    history.record("back", { pageIndex: 2, componentIndex: 1 });
    history.annotate({ pageIndex: 2, componentIndex: 2 });
    expect(history.record("back", { pageIndex: 0 })).toBe(false);
    expect(history.move(-1)).toBe("front"); expect(history.context.value).toEqual({ pageIndex: 2, componentIndex: 1 });
    expect(history.move(-1)).toBe("initial"); expect(history.context.value).toEqual({ pageIndex: 0, componentIndex: 0 });
    expect(history.move(1)).toBe("front"); expect(history.context.value).toEqual({ pageIndex: 1 });
    expect(history.move(1)).toBe("back"); expect(history.context.value).toEqual({ pageIndex: 2, componentIndex: 2 });
    history.record("next", { pageIndex: 2 });
    expect(history.retainedBytes.value).toBeLessThan(1000);
    expect(history.move(-1)).toBe("back"); expect(history.move(-1)).toBe("front");
    expect(history.move(-1)).toBeUndefined();
  });
});
