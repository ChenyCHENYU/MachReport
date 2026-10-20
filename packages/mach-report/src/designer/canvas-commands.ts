import {
  resolveGridLayout,
  type GridCell,
  type ListComponent,
  type PlanGrid,
  type ReportTemplateDocument,
  type TemplateComponent,
} from "@agile-team/mach-report";

export interface HeaderCommand {
  action: "add" | "merge" | "split";
  row: number;
  first: number;
  last: number;
}
export interface CanvasSelection {
  /** Ctrl/Command/Shift toggles the selection without changing the report schema. */
  additive?: boolean;
  pageIndex: number;
  componentIndex: number;
}
export interface CanvasGeometry {
  leftMm: number;
  topMm: number;
  widthMm: number;
  heightMm: number;
}
export type CanvasInsertKind = "text" | "list" | "image" | "rect";
export const CANVAS_MM_TO_PX = 96 / 25.4;
export function componentHeight(component: TemplateComponent): number {
  return component.kind === "list"
    ? Math.max(
        16,
        (component.headerGrid?.rowHeightsMm?.reduce(
          (sum, height) => sum + height,
          0,
        ) ?? 8) +
          (component.rowHeightMm ?? 8) * 3,
      )
    : component.heightMm;
}
export function componentGeometry(
  component: TemplateComponent,
): CanvasGeometry {
  return {
    leftMm: component.leftMm,
    topMm: component.topMm,
    widthMm: component.widthMm,
    heightMm: componentHeight(component),
  };
}
export function selectedComponent(
  document: ReportTemplateDocument,
  selection?: CanvasSelection,
): TemplateComponent | undefined {
  return selection
    ? document.template.pages[selection.pageIndex]?.components[
        selection.componentIndex
      ]
    : undefined;
}
export function createCanvasComponent(
  kind: CanvasInsertKind,
  dataset = "detail",
): TemplateComponent {
  const base = { leftMm: 10, topMm: 10, widthMm: 60, heightMm: 10 };
  if (kind === "list")
    return {
      kind,
      leftMm: 10,
      topMm: 30,
      widthMm: 90,
      dataset,
      columns: [
        { header: "字段", field: "field", widthMm: 45 },
        { header: "数值", field: "value", widthMm: 45 },
      ],
      border: true,
      headerBackgroundColor: "#eaf2fc",
      headerAlign: "center",
    };
  if (kind === "text")
    return {
      ...base,
      kind,
      text: "文本",
      style: { fontSize: 12, color: "#233c5c" },
    };
  if (kind === "rect")
    return {
      ...base,
      kind,
      style: {
        borderColor: "#cbd5e1",
        lineWidthPt: 0.75,
        backgroundColor: "#eff6ff",
      },
    };
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="90" viewBox="0 0 180 90"><rect width="180" height="90" rx="5" fill="#eff6ff"/><path d="m25 68 32-32 25 23 27-35 45 44" fill="none" stroke="#94b8e5" stroke-width="3"/><circle cx="45" cy="24" r="7" fill="#bfd5ef"/></svg>';
  return {
    ...base,
    kind,
    widthMm: 48,
    heightMm: 24,
    imageData: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  };
}
export function constrainGeometry(
  geometry: CanvasGeometry,
  page: { widthMm: number; heightMm: number },
  list = false,
): CanvasGeometry {
  const widthMm = Math.max(2, Math.min(page.widthMm, geometry.widthMm));
  const heightMm = Math.max(2, Math.min(page.heightMm, geometry.heightMm));
  return {
    leftMm: Math.max(0, Math.min(page.widthMm - widthMm, geometry.leftMm)),
    topMm: Math.max(
      0,
      Math.min(page.heightMm - (list ? 2 : heightMm), geometry.topMm),
    ),
    widthMm,
    heightMm,
  };
}
export function setCanvasGeometry(
  component: TemplateComponent,
  geometry: CanvasGeometry,
): void {
  const oldWidth = component.widthMm;
  Object.assign(component, {
    leftMm: geometry.leftMm,
    topMm: geometry.topMm,
    widthMm: geometry.widthMm,
  });
  if (component.kind !== "list") component.heightMm = geometry.heightMm;
  else if (oldWidth > 0 && geometry.widthMm !== oldWidth) {
    const factor = geometry.widthMm / oldWidth;
    component.columns.forEach((column) => {
      column.widthMm = Math.round(column.widthMm * factor * 100) / 100;
    });
    component.widthMm = component.columns.reduce(
      (sum, column) => sum + column.widthMm,
      0,
    );
    if (component.headerGrid)
      component.headerGrid.colWidthsMm = component.columns.map(
        (column) => column.widthMm,
      );
  }
}
export function moveCanvasColumn(
  list: ListComponent,
  from: number,
  to: number,
): boolean {
  if (from === to || !list.columns[from] || !list.columns[to]) return false;
  if (list.headerGrid) {
    const boxes = resolveGridLayout(list.headerGrid, list.widthMm, 100).cells;
    if (boxes.some(({ cell }) => (cell.colSpan ?? 1) > 1))
      throw new Error("请先拆分跨列合并表头，再调整列顺序，避免改变业务分组。");
    const matrix = headerMatrix(list);
    matrix.forEach((row) => {
      row.splice(to, 0, row.splice(from, 1)[0]!);
    });
    list.headerGrid = compactGrid(
      matrix,
      list.columns.map((column) => column.widthMm),
      list.headerGrid.rowHeightsMm ?? matrix.map(() => 8),
    );
  }
  list.columns.splice(to, 0, list.columns.splice(from, 1)[0]!);
  if (list.headerGrid)
    list.headerGrid.colWidthsMm = list.columns.map((column) => column.widthMm);
  return true;
}
function headerMatrix(list: ListComponent): Array<Array<GridCell | null>> {
  if (!list.headerGrid)
    return [list.columns.map((column) => ({ text: column.header }))];
  const rows: Array<Array<GridCell | null>> = Array.from(
    { length: list.headerGrid.cells.length },
    () => Array.from({ length: list.columns.length }, () => null),
  );
  for (const { cell, ri, ci } of resolveGridLayout(
    list.headerGrid,
    list.widthMm,
    100,
  ).cells)
    rows[ri]![ci] = cell;
  return rows;
}
function compactGrid(
  matrix: Array<Array<GridCell | null>>,
  widths: number[],
  heights: number[],
): PlanGrid {
  const covered = new Set<string>();
  const cells = matrix.map((row, ri) =>
    row.flatMap((cell, ci) => {
      if (covered.has(`${ri}:${ci}`)) return [];
      if (!cell) return [null];
      for (let r = ri; r < ri + (cell.rowSpan ?? 1); r++)
        for (let c = ci; c < ci + (cell.colSpan ?? 1); c++)
          if (r !== ri || c !== ci) covered.add(`${r}:${c}`);
      return [cell];
    }),
  );
  return { cells, colWidthsMm: widths, rowHeightsMm: heights };
}
export function addCanvasHeaderRow(list: ListComponent): void {
  const matrix = headerMatrix(list);
  const oldHeights = list.headerGrid?.rowHeightsMm ?? matrix.map(() => 8);
  matrix.unshift(
    list.columns.map(() => ({
      text: "分组",
      style: { align: "center", backgroundColor: "#eaf2fc", bold: true },
    })),
  );
  list.headerGrid = compactGrid(
    matrix,
    list.columns.map((column) => column.widthMm),
    [8, ...oldHeights],
  );
}
export function mergeCanvasHeader(
  list: ListComponent,
  row: number,
  first: number,
  last: number,
): void {
  if (first >= last || first < 0 || last >= list.columns.length)
    throw new Error("请选择同一行的至少两个连续表头。");
  const matrix = headerMatrix(list),
    cells = matrix[row];
  if (!cells) throw new Error("表头行不存在。");
  const targets = cells.slice(first, last + 1);
  if (
    targets.some(
      (cell) => !cell || (cell.colSpan ?? 1) !== 1 || (cell.rowSpan ?? 1) !== 1,
    )
  )
    throw new Error("选择包含合并区域，请先拆分，再重新合并。");
  const cell = targets[0]!;
  cells[first] = { ...cell, colSpan: last - first + 1 };
  for (let index = first + 1; index <= last; index++) cells[index] = null;
  list.headerGrid = compactGrid(
    matrix,
    list.columns.map((column) => column.widthMm),
    list.headerGrid?.rowHeightsMm ?? [8],
  );
}
export function splitCanvasHeader(
  list: ListComponent,
  row: number,
  column: number,
): void {
  if (!list.headerGrid) return;
  const boxes = resolveGridLayout(list.headerGrid, list.widthMm, 100).cells;
  const box = boxes.find(
    ({ ri, ci, cell }) =>
      row >= ri &&
      row < ri + (cell.rowSpan ?? 1) &&
      column >= ci &&
      column < ci + (cell.colSpan ?? 1),
  );
  if (!box) return;
  const matrix = headerMatrix(list),
    { ri, ci, cell } = box;
  for (let r = ri; r < ri + (cell.rowSpan ?? 1); r++)
    for (let c = ci; c < ci + (cell.colSpan ?? 1); c++) {
      const next = {
        ...cell,
        text: r === matrix.length - 1 ? list.columns[c]!.header : cell.text,
      };
      delete next.colSpan;
      delete next.rowSpan;
      matrix[r]![c] = next;
    }
  list.headerGrid = compactGrid(
    matrix,
    list.columns.map((column) => column.widthMm),
    list.headerGrid.rowHeightsMm ?? matrix.map(() => 8),
  );
}
