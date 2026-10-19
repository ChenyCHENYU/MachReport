// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createTableTemplate,
  defineReportTemplate,
  resolveGridLayout,
  validateReportTemplateDocument,
  type ListComponent,
} from "../../index";
import { canvasSnapMarks, snapCanvasAxis } from "../canvas-snap";
import {
  addCanvasHeaderRow,
  componentGeometry,
  constrainGeometry,
  createCanvasComponent,
  mergeCanvasHeader,
  moveCanvasColumn,
  setCanvasGeometry,
  splitCanvasHeader,
} from "../canvas-commands";
function fixture() {
  const document = defineReportTemplate({
    id: "canvas",
    name: "Canvas",
    template: createTableTemplate({
      layout: "wide",
      columns: [
        { field: "id", header: "编号" },
        { field: "weight", header: "重量" },
        { field: "energy", header: "电量" },
      ],
    }),
  });
  return {
    document,
    list: document.template.pages[0]!.components.find(
      (item) => item.kind === "list",
    ) as ListComponent,
  };
}
describe("可视化设计命令", () => {
  it("吸附优先最近边/中线并返回辅助线，大目录仅二分查找，非命中落半毫米网格", () => {
    const text = createCanvasComponent("text"),
      peer = createCanvasComponent("text");
    peer.leftMm = 50;
    peer.widthMm = 20;
    const marks = canvasSnapMarks([text, peer], text, "leftMm");
    expect(marks).toEqual([50, 60, 70]);
    expect(snapCanvasAxis(40.7, 20, marks, 1)).toEqual({
      value: 40,
      guide: 50,
    });
    expect(snapCanvasAxis(3.3, 20, marks, 1)).toEqual({ value: 3.5 });
    expect(snapCanvasAxis(5, 20, [], 1)).toEqual({ value: 5 });
  });
  it("四种组件生成真实有效的模板，几何限制保留毫米精度", () => {
    const { document } = fixture();
    for (const kind of ["text", "list", "image", "rect"] as const)
      document.template.pages[0]!.components.push(createCanvasComponent(kind));
    expect(validateReportTemplateDocument(document).ok).toBe(true);
    expect(
      constrainGeometry(
        { leftMm: -5, topMm: 80, widthMm: 200, heightMm: 40 },
        { widthMm: 100, heightMm: 100 },
      ),
    ).toEqual({ leftMm: 0, topMm: 60, widthMm: 100, heightMm: 40 });
  });
  it("列表缩放同步列宽和真实合并表头宽度", () => {
    const { list } = fixture();
    addCanvasHeaderRow(list);
    const original = list.widthMm;
    setCanvasGeometry(list, {
      ...componentGeometry(list),
      widthMm: original * 2,
    });
    expect(list.columns.map((column) => column.widthMm)).toEqual([60, 60, 60]);
    expect(list.headerGrid!.colWidthsMm).toEqual([60, 60, 60]);
  });
  it("多层表头合并/拆分保持物理列和校验；不能跨已有合并破坏结构", () => {
    const { document, list } = fixture();
    addCanvasHeaderRow(list);
    mergeCanvasHeader(list, 0, 0, 1);
    expect(
      resolveGridLayout(list.headerGrid!, 90, 16)
        .cells.filter((box) => box.ri === 0)
        .map((box) => [box.ci, box.cell.colSpan ?? 1]),
    ).toEqual([
      [0, 2],
      [2, 1],
    ]);
    expect(validateReportTemplateDocument(document).ok).toBe(true);
    expect(() => mergeCanvasHeader(list, 0, 0, 2)).toThrow("先拆分");
    expect(() => moveCanvasColumn(list, 0, 1)).toThrow("拆分");
    splitCanvasHeader(list, 0, 1);
    expect(resolveGridLayout(list.headerGrid!, 90, 16).cells).toHaveLength(6);
    expect(validateReportTemplateDocument(document).ok).toBe(true);
  });
  it("列排序保留字段/格式和独立表头原有内容，边界不变更", () => {
    const { document, list } = fixture();
    addCanvasHeaderRow(list);
    list.columns[0]!.format = { kind: "number", digits: 3 };
    expect(moveCanvasColumn(list, 0, 2)).toBe(true);
    expect(list.columns.map((column) => column.field)).toEqual([
      "weight",
      "energy",
      "id",
    ]);
    expect(list.columns[2]!.format).toMatchObject({ digits: 3 });
    const bottom = resolveGridLayout(list.headerGrid!, 90, 16)
      .cells.filter((box) => box.ri === 1)
      .map((box) => box.cell.text);
    expect(bottom).toEqual(["重量", "电量", "编号"]);
    expect(validateReportTemplateDocument(document).ok).toBe(true);
    expect(moveCanvasColumn(list, -1, 1)).toBe(false);
    expect(moveCanvasColumn(list, 1, 1)).toBe(false);
  });
  it("拒绝无效合并范围，已合并底行拆分恢复各列业务标题", () => {
    const { list } = fixture();
    expect(() => mergeCanvasHeader(list, 0, 1, 1)).toThrow();
    expect(() => mergeCanvasHeader(list, 9, 0, 1)).toThrow();
    mergeCanvasHeader(list, 0, 0, 2);
    splitCanvasHeader(list, 0, 1);
    expect(list.headerGrid!.cells[0]!.map((cell) => cell?.text)).toEqual([
      "编号",
      "重量",
      "电量",
    ]);
  });
});
