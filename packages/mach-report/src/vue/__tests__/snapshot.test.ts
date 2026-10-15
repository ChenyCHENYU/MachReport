import { describe, expect, it } from "vitest";
import { reactive } from "vue";
import { cloneReportSnapshot } from "../snapshot";

describe("report JSON snapshots", () => {
  it("copies reactive DTOs while retaining zero, null, booleans and text identifiers", () => {
    const source = reactive({ cells: [{ value: 0, text: "0.000" }, { value: null }, { value: false }, { value: "00123" }] });
    const copy = cloneReportSnapshot(source);
    expect(copy).toEqual(source);
    copy.cells[0]!.text = "外部草稿";
    expect(source.cells[0]!.text).toBe("0.000");
    source.cells[3]!.value = "0000";
    expect(copy.cells[3]!.value).toBe("00123");
  });
});
