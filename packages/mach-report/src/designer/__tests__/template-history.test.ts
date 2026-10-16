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
});
