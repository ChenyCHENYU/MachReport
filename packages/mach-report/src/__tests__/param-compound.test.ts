// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { assertReportParams, reportParamsJsonSchema, validateReportParamDefinitions, validateReportParams } from "../source/param-validation";
import { formatReportParamSelection, parseReportParamSelection, formatReportCascaderPath, parseReportCascaderPath, formatReportNumberRange, parseReportNumberRange, validReportParamOptions } from "../source/param-compound";
import { createReportSource } from "../source/report-source";
import type { ReportParamDef, ReportParamTreeOption } from "../layout/paginate";
const tree: ReportParamTreeOption[] = [{ value: "CN", label: "中国", children: [{ value: "CN", label: "同名下级", children: [{ value: "0001", label: "工厂" }] }] }];
const defs: ReportParamDef[] = [
  { field: "plants", type: "multiSelect", minItems: 1, maxItems: 2, options: [{ value: "a,b", label: "A" }, { value: "00/甲", label: "B" }] },
  { field: "area", type: "cascader", options: tree },
  { field: "weight", type: "numberRange", min: 0, max: 100 },
];
describe("bounded native compound parameter contracts", () => {
  it("normalizes typed inputs and JSON strings with independent snapshots, preserving IDs and delimiters", () => {
    const input = ["a,b", "00/甲"], range = [0, 1.25];
    const result = validateReportParams(defs, { plants: input, area: '[ "CN", "CN", "0001" ]', weight: range });
    expect(result.ok).toBe(true);
    expect(result.values).toEqual({ plants: '["a,b","00/甲"]', area: '["CN","CN","0001"]', weight: '[0,1.25]' });
    expect(result.typedValues).toEqual({ plants: ["a,b", "00/甲"], area: ["CN", "CN", "0001"], weight: [0, 1.25] });
    input[0] = "mutated"; range[0] = 99; expect(result.typedValues.plants).toEqual(["a,b", "00/甲"]); expect(result.typedValues.weight).toEqual([0, 1.25]);
    expect(parseReportParamSelection(formatReportParamSelection(["a,b", "00/甲"]))).toEqual(["a,b", "00/甲"]);
    expect(parseReportCascaderPath(formatReportCascaderPath(["CN", "CN", "0001"]))).toEqual(["CN", "CN", "0001"]);
    expect(parseReportNumberRange(formatReportNumberRange([0, 1.25]))).toEqual([0, 1.25]);
  });
  it("enforces selection membership/count, leaf paths, ordered finite ranges and bounds on both ends", () => {
    for (const raw of [JSON.stringify(JSON.stringify(["a,b"])), "A,B", '["a,b","a,b"]', '[null]', '[1]', '["missing"]', JSON.stringify(Array.from({ length: 101 }, (_, i) => String(i)))]) expect(validateReportParams(defs, { plants: raw }).ok).toBe(false);
    for (const raw of ['["CN"]', '["CN", "wrong"]', '["CN",null]', JSON.stringify(Array(17).fill("CN"))]) expect(validateReportParams(defs, { area: raw }).ok).toBe(false);
    for (const raw of [JSON.stringify(JSON.stringify([1,2])), '[1,null]', '[2,1]', '[1,2,3]', '["1",2]', '[1e999,2]', '[-1,10]', '[1,101]']) expect(validateReportParams(defs, { weight: raw }).ok).toBe(false);
    expect(validateReportParams([{ ...defs[0]!, maxItems: 1 }], { plants: '["a,b","00/甲"]' }).issues[0]?.code).toBe("maxItems");
    expect(validateReportParams([{ ...defs[0]!, minItems: 2 }], { plants: '["a,b"]' }).issues[0]?.code).toBe("minItems");
    expect(validateReportParams(defs, { plants: '["missing"]' }).typedValues.plants).toBeUndefined();
  });
  it("treats empty arrays as explicit clear, required as missing, and validates compound defaults", () => {
    expect(validateReportParams(defs, { plants: "[]" })).toMatchObject({ ok: true, values: { plants: "" }, typedValues: {} });
    expect(validateReportParams([{ ...defs[0]!, required: true }], { plants: [] }).issues[0]?.code).toBe("required");
    expect(validateReportParamDefinitions([{ ...defs[0]!, defaultValue: '["a,b"]' }])).toEqual([]);
    expect(validateReportParamDefinitions([{ ...defs[0]!, required: true, defaultValue: "[]" }])[0]?.code).toBe("definition");
    expect(validateReportParamDefinitions([{ ...defs[2]!, defaultValue: '[5,2]' }])[0]?.code).toBe("definition");
  });
  it("rejects huge strings, cyclic/deep trees, sibling duplicates and inappropriate bounds", () => {
    const cyclic: ReportParamTreeOption = { label: "x", value: "x" }; cyclic.children = [cyclic];
    const deep: ReportParamTreeOption = { label: "x", value: "x" }; let cursor = deep;
    for (let i = 0; i < 16; i++) { cursor.children = [{ label: "x", value: "x" }]; cursor = cursor.children[0]!; }
    for (const options of [[cyclic], [deep], [{ label: "a", value: "a" }, { label: "b", value: "a" }], Array.from({ length: 1001 }, (_, i) => ({ label: "x", value: String(i) }))]) expect(validateReportParamDefinitions([{ field: "x", type: "cascader", options }]).length).toBeGreaterThan(0);
    for (const def of [{ ...defs[0]!, maxItems: 101 }, { ...defs[0]!, minItems: 3, maxItems: 2 }, { ...defs[1]!, minItems: 1 }, { ...defs[2]!, maxLength: 3 }]) expect(validateReportParamDefinitions([def]).length).toBeGreaterThan(0);
    expect(parseReportParamSelection(' '.repeat(104_858))).toBeUndefined();
    expect(parseReportParamSelection(["a".repeat(1025)])).toBeUndefined();
    expect(() => formatReportParamSelection(["a", "a"])).toThrow(TypeError);
    expect(() => formatReportNumberRange([2, 1])).toThrow(TypeError);
  });
  it("rejects escaped native selections exceeding the same canonical wire budget", () => {
    const oversized = Array.from({ length: 100 }, (_, index) => "\\".repeat(1020) + String(index));
    expect(parseReportParamSelection(oversized)).toBeUndefined();
    expect(parseReportParamSelection(JSON.stringify(oversized))).toBeUndefined();
    expect(() => formatReportParamSelection(oversized)).toThrow(TypeError);
    expect(validateReportParams([{ field: "many", type: "multiSelect" }], { many: oversized }).ok).toBe(false);
    const bounded = oversized.slice(0, 50), wire = formatReportParamSelection(bounded);
    expect(parseReportParamSelection(wire)).toEqual(bounded);
  });
  it("rejects custom iterators, index accessors, sparse arrays and tree accessors without executing them", () => {
    const execute = vi.fn(() => { throw new Error("Must not execute"); });
    const selection = ["safe"];
    Object.defineProperty(selection, Symbol.iterator, { get: execute });
    expect(parseReportParamSelection(selection)).toBeUndefined();
    const index = ["safe"];
    Object.defineProperty(index, "0", { get: execute }); expect(parseReportCascaderPath(index)).toBeUndefined();
    expect(parseReportParamSelection(new Array(2))).toBeUndefined();
    const range = [0, 1]; Object.defineProperty(range, Symbol.iterator, { value: execute }); expect(parseReportNumberRange(range)).toBeUndefined();
    const rangeIndex = [0, 1]; Object.defineProperty(rangeIndex, "0", { get: execute }); expect(parseReportNumberRange(rangeIndex)).toBeUndefined();
    const options = [{ value: "a", label: "A" }]; Object.defineProperty(options, Symbol.iterator, { get: execute }); expect(validReportParamOptions(options, true)).toBe(false);
    const child = { value: "a", label: "A" }; Object.defineProperty(child, "children", { get: execute }); expect(validReportParamOptions([child], true)).toBe(false);
    const label = { value: "a", label: "A" }; Object.defineProperty(label, "label", { get: execute }); expect(validReportParamOptions([label], true)).toBe(false);
    expect(validReportParamOptions(new Array(2), true)).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
  it("exports typed array schemas and canonical wire metadata, including defaults", () => {
    expect(reportParamsJsonSchema([{ ...defs[0]!, defaultValue: '["a,b"]' }, defs[1]!, defs[2]!])).toMatchObject({ properties: {
      plants: { type: "array", uniqueItems: true, maxItems: 2, default: ["a,b"], "x-report-wire-encoding": "json", items: { enum: ["a,b", "00/甲"] } },
      area: { type: "array", maxItems: 16, "x-report-cascader": { leafOnly: true } },
      weight: { type: "array", minItems: 2, maxItems: 2, "x-report-number-range": { ordered: true } },
    } });
  });
  it("uses the same validation before Provider requests and passes canonical strings only", async () => {
    const load = vi.fn(() => ({}));
    const source = createReportSource({ test: { template: { params: defs, pages: [{ widthMm: 100, heightMm: 100, components: [] }] }, load } });
    await expect(source({ reportIds: ["test"], params: { weight: "[2,null]" } })).rejects.toMatchObject({ code: "params" }); expect(load).not.toHaveBeenCalled();
    await source({ reportIds: ["test"], params: { weight: "[ 0, 10 ]", area: '["CN","CN","0001"]' } });
    expect(load.mock.calls[0]).toBeDefined();
    expect(assertReportParams(defs, { weight: [0, 10] })).toMatchObject({ weight: "[0,10]" });
  });
});
