// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { paginateTemplate, paginateTemplatePages, type ListComponent, type ReportTemplate } from "../layout/paginate";
import { wrapText } from "../layout/textwrap";
import { createGroupHeaderRows } from "../layout/group-header-cache";
import type { ComponentStyle } from "../schema/render-plan";

vi.mock("../layout/textwrap", async importOriginal => {
  const actual = await importOriginal<typeof import("../layout/textwrap")>();
  return { ...actual, wrapText: vi.fn(actual.wrapText) };
});

function nested(depth: number, count: number, keepWithNext: boolean) {
  const rows = Array.from({ length: count }, (_, row) => Object.fromEntries([
    ["value", row], ...Array.from({ length: depth }, (_, level) => [`g${level}`, `group-${level}-${row}`])
  ]));
  const list: ListComponent = {
    kind: "list", dataset: "rows", leftMm: 0, topMm: 0, widthMm: 100,
    columns: [{ field: "value", header: "value", widthMm: 100 }],
    groups: Array.from({ length: depth }, (_, level) => ({ field: `g${level}`, headerTemplate: "Group [{value}]", keepWithNext }))
  };
  const template: ReportTemplate = { pages: [{ widthMm: 100, heightMm: 1_000_000, components: [list] }] };
  return { template, rows };
}
function reference(keepWithNext: boolean) {
  const list: ListComponent = {
    kind: "list", id: "group", dataset: "rows", rowKey: "id", leftMm: 3, topMm: 5, widthMm: 90, paddingMm: 0.5, fontSizePt: 8,
    columns: [{ field: "id", header: "ID", widthMm: 15 }, { field: "plant", header: "Plant", widthMm: 20 },
      { field: "value", header: "Amount", widthMm: 30, format: { kind: "number", digits: 2 } }, { field: "weight", header: "Weight", widthMm: 25 }],
    groups: [{ field: "plant", headerTemplate: "Plant [{value}]", headerStyle: { fontSize: 9, bold: true, color: "#123456" }, repeatHeader: true, subtotal: ["value"], subtotalLabel: "Plant total", keepWithNext },
      { field: "shift", headerTemplate: "Shift [{value}]", headerStyle: { fontSize: 8, italic: true, align: "right" }, repeatHeader: true, keepWithNext,
        aggregates: [{ field: "weight", valueField: "value", weightField: "weight", op: "weightedAvg" }], subtotalLabel: "Shift total" }],
    grandTotal: { fields: ["value"], label: "Grand total" }
  };
  const rows = [{ id: "a", plant: 0, shift: false, value: 0, weight: 1 }, { id: "b", plant: 0, shift: false, value: 0.25, weight: 2 },
    { id: "c", plant: false, shift: "", value: null, weight: 1 }, { id: "d", plant: "0", shift: null, value: 0.5, weight: 2 },
    { id: "e", plant: undefined, shift: undefined, value: 1.5, weight: 1 }, { id: "f", plant: null, shift: 0, value: 2, weight: 1 },
    { id: "g", plant: 0, shift: "long repeated shift value", value: 1.25, weight: 1 }];
  const template: ReportTemplate = { pages: [{ widthMm: 100, heightMm: 58, marginTopMm: 3, marginBottomMm: 3, components: [list,
    { kind: "text", pageAnchor: "footer", nid: "footer", leftMm: 3, topMm: 53, widthMm: 90, heightMm: 2, text: "Page {page}/{totalPages}" }] }] };
  return { template, rows };
}

describe("bounded nested group-header measurement", () => {
  it.each([true, false])("measures each real header once at 16 levels, keepWithNext=%s", keep => {
    const { template, rows } = nested(16, 20, keep);
    vi.mocked(wrapText).mockClear();
    const { plan } = paginateTemplate(template, { rows });
    const headers = plan.pages.flatMap(page => page.components).filter(component => component.table?.role === "group-header");
    expect(headers).toHaveLength(320);
    const headerWraps = vi.mocked(wrapText).mock.calls.filter(([text]) => text.startsWith("Group ["));
    expect(headerWraps).toHaveLength(headers.length);
    for (const header of headers) expect(header.grid?.cells[0]?.[0]?.text).toMatch(/^Group \[group-\d+-\d+\]$/);
  });

  it.each([
    [true, "cc80e0b86e6712632952c94d41c6dcc5cea56027141d5086428d3199bcad81ae"],
    [false, "d022f42aa138ba9e76f560bc7ea0ee6a3fb627d678daed99ba6dfbdfc778ef47"]
  ] as const)("preserves the complete pre-optimization plan with keepWithNext=%s", (keep, hash) => {
    const { template, rows } = reference(keep);
    const result = paginateTemplate(template, { rows });
    // Recorded from 2.25.0 before the optimization. Covers every coordinate,
    // style, nid, logical row index, subtotal and repeated-header fragment.
    expect(createHash("sha256").update(JSON.stringify(result)).digest("hex")).toBe(hash);
    expect(result.plan.pages).toHaveLength(5);
    expect([...paginateTemplatePages(template, { rows })]).toEqual(result.plan.pages);
    const body = result.plan.pages.flatMap(page => page.components).filter(component => component.table?.role === "body");
    expect(body.map(component => component.table?.source?.rowKey)).toEqual(["a", "b", "g", "c", "d", "e", "f"]);
    expect(body[0]?.grid?.cells[0]?.[2]?.value).toBe(0);
    result.plan.pages.forEach((page, index) => expect(page.components.at(-1)?.text).toBe(`Page ${index + 1}/5`));
  });

  it("honors cancellation after a page was yielded and does not retain measurements between calls", () => {
    const { template, rows } = reference(true), controller = new AbortController();
    const pages = paginateTemplatePages(template, { rows }, { signal: controller.signal });
    expect(pages.next().done).toBe(false);
    controller.abort();
    expect(() => pages.next()).toThrow("取消");
    const first = paginateTemplate(template, { rows });
    const list = template.pages[0]!.components[0] as ListComponent;
    list.groups![0]!.headerStyle!.fontSize = 13;
    const next = paginateTemplate(template, { rows });
    expect(next.plan).not.toEqual(first.plan);
    const header = next.plan.pages[0]!.components.find(component => component.table?.role === "group-header");
    expect(header?.grid?.cells[0]?.[0]?.style?.fontSize).toBe(13);
  });
});

describe("group-header cache ownership", () => {
  it("retains only the latest first row at each supported depth", () => {
    const build = vi.fn((label: string) => ({ label })), read = createGroupHeaderRows(build), first = {};
    const original = Array.from({ length: 16 }, (_, depth) => read(depth, first, "same label"));
    original.forEach((row, depth) => expect(read(depth, first, "same label")).toBe(row));
    expect(build).toHaveBeenCalledTimes(16);
    for (let index = 0; index < 100; index++) read(0, {}, "same label");
    expect(read(0, first, "same label")).not.toBe(original[0]);
    expect(build).toHaveBeenCalledTimes(117);
    expect(read(1, first, "same label")).toBe(original[1]);
  });

  it("invalidates on label, shallow style values or style key changes", () => {
    const build = vi.fn((label: string, style?: ComponentStyle) => ({ label, style: { ...style } }));
    const read = createGroupHeaderRows(build), first = {}, style: ComponentStyle = { fontSize: 9 };
    const original = read(0, first, "A", style);
    expect(read(0, first, "A", { fontSize: 9 })).toBe(original);
    style.fontSize = 12;
    const modified = read(0, first, "A", style);
    expect(modified).not.toBe(original);
    expect(modified.style.fontSize).toBe(12);
    const renamed = read(0, first, "B", style);
    expect(renamed).not.toBe(modified);
    style.fontSizePx = undefined;
    expect(read(0, first, "B", style)).not.toBe(renamed);
    expect(build).toHaveBeenCalledTimes(4);
  });

  it("does not cache unsupported depths, accessor styles or exotic style instances", () => {
    const build = vi.fn((label: string) => ({ label })), read = createGroupHeaderRows(build), first = {};
    const accessor = { get fontSize() { return 9; } };
    class CustomStyle { fontSize = 9; }
    for (const depth of [-1, 0.5, 16, 1_000_000]) {
      expect(read(depth, first, "A")).not.toBe(read(depth, first, "A"));
    }
    const symbolStyle = { [Symbol("style")]: 9 }, hiddenStyle = Object.defineProperty({}, "fontSizePx", { value: 24 });
    const proxyStyle = new Proxy({}, { getPrototypeOf() { throw new Error("not introspectable"); } });
    for (const style of [accessor, new CustomStyle(), { color: {} } as unknown as ComponentStyle, symbolStyle, hiddenStyle, proxyStyle]) {
      expect(read(0, first, "A", style)).not.toBe(read(0, first, "A", style));
    }
    expect(build).toHaveBeenCalledTimes(20);
    const plainStyle: ComponentStyle = Object.assign(Object.create(null), { bold: true });
    expect(read(0, first, "A", plainStyle)).toBe(read(0, first, "A", plainStyle));
    expect(build).toHaveBeenCalledTimes(21);
  });
});
