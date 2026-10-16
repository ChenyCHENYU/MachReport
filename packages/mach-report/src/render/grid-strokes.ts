import type { ComponentStyle, PlanComponent } from "../schema/render-plan";
import type { GridCellBox, GridEdge, GridLayout } from "./grid-geometry";
import { mergeComponentStyles, resolveBoxBorders, resolveStroke } from "./style";

export interface GridStroke extends GridEdge { color: string; widthPt: number }

const BORDER_KEYS = ["borderTop", "borderRight", "borderBottom", "borderLeft", "borderColor", "lineColor", "lineWidthPt"] as const;

function legacyStrokes(layout: GridLayout, comp: PlanComponent): GridStroke[] {
  const borders = resolveBoxBorders(comp.style);
  const edges: GridEdge[] = borders.inner ? [...layout.edges] : [];
  if (borders.top) edges.push({ kind: "h", pos: 0, from: 0, to: comp.widthMm });
  if (borders.bottom) edges.push({ kind: "h", pos: comp.heightMm, from: 0, to: comp.widthMm });
  if (borders.left) edges.push({ kind: "v", pos: 0, from: 0, to: comp.heightMm });
  if (borders.right) edges.push({ kind: "v", pos: comp.widthMm, from: 0, to: comp.heightMm });
  const stroke = resolveStroke(comp.style);
  return edges.map((edge) => ({ ...edge, ...stroke }));
}

function putStroke(edges: Map<string, GridStroke>, key: string, edge: GridStroke): void {
  const previous = edges.get(key);
  // 相邻单元格共边只画一次；更粗的显式边框优先，同粗保留稳定的行列顺序。
  if (!previous || edge.widthPt > previous.widthPt) edges.set(key, edge);
}

function horizontal(edges: Map<string, GridStroke>, layout: GridLayout, row: number, from: number, to: number, stroke: ReturnType<typeof resolveStroke>): void {
  const pos = row < layout.rows.length ? layout.rows[row]!.pos : layout.rows[layout.rows.length - 1]!.pos + layout.rows[layout.rows.length - 1]!.size;
  for (let column = from; column < to; column++) {
    const axis = layout.columns[column]!;
    putStroke(edges, `h:${row}:${column}`, { kind: "h", pos, from: axis.pos, to: axis.pos + axis.size, ...stroke });
  }
}

function vertical(edges: Map<string, GridStroke>, layout: GridLayout, column: number, from: number, to: number, stroke: ReturnType<typeof resolveStroke>): void {
  const pos = column < layout.columns.length ? layout.columns[column]!.pos : layout.columns[layout.columns.length - 1]!.pos + layout.columns[layout.columns.length - 1]!.size;
  for (let row = from; row < to; row++) {
    const axis = layout.rows[row]!;
    putStroke(edges, `v:${column}:${row}`, { kind: "v", pos, from: axis.pos, to: axis.pos + axis.size, ...stroke });
  }
}

function cellStrokes(edges: Map<string, GridStroke>, layout: GridLayout, box: Pick<GridCellBox, "ri" | "ci" | "cell">, style: ComponentStyle | undefined): void {
  const right = Math.min(layout.columns.length, box.ci + (box.cell.colSpan ?? 1));
  const bottom = Math.min(layout.rows.length, box.ri + (box.cell.rowSpan ?? 1));
  const merged = mergeComponentStyles(style, box.cell.style);
  const borders = resolveBoxBorders(merged), stroke = resolveStroke(merged);
  if (borders.top) horizontal(edges, layout, box.ri, box.ci, right, stroke);
  if (borders.bottom) horizontal(edges, layout, bottom, box.ci, right, stroke);
  if (borders.left) vertical(edges, layout, box.ci, box.ri, bottom, stroke);
  if (borders.right) vertical(edges, layout, right, box.ri, bottom, stroke);
}

function mergedStrokes(edges: Map<string, GridStroke>): GridStroke[] {
  const sorted = [...edges.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.pos - b.pos || a.from - b.from);
  const result: GridStroke[] = [];
  for (const edge of sorted) {
    const previous = result[result.length - 1];
    if (previous && previous.kind === edge.kind && previous.pos === edge.pos && Math.abs(previous.to - edge.from) < 0.000001 && previous.color === edge.color && previous.widthPt === edge.widthPt) previous.to = edge.to;
    else result.push({ ...edge });
  }
  return result;
}

/** 三个视觉出口共用边线：旧默认网格走快路径，声明单元格边框时保留单边、颜色和合并跨度。 */
export function resolveGridStrokes(layout: GridLayout, comp: PlanComponent): GridStroke[] {
  if (!layout.cells.some(({ cell }) => BORDER_KEYS.some((key) => cell.style?.[key] !== undefined))) return legacyStrokes(layout, comp);
  const edges = new Map<string, GridStroke>(), occupied = new Set<number>();
  const columns = layout.columns.length;
  for (const box of layout.cells) {
    cellStrokes(edges, layout, box, comp.style);
    const bottom = Math.min(layout.rows.length, box.ri + (box.cell.rowSpan ?? 1));
    const right = Math.min(columns, box.ci + (box.cell.colSpan ?? 1));
    for (let row = box.ri; row < bottom; row++) for (let column = box.ci; column < right; column++) occupied.add(row * columns + column);
  }
  // 稀疏手写网格的隐式空格沿用默认边框，不因某一格声明样式而丢失其他区域。
  for (let row = 0; row < layout.rows.length; row++) for (let column = 0; column < columns; column++) {
    if (!occupied.has(row * columns + column)) cellStrokes(edges, layout, { ri: row, ci: column, cell: {} }, comp.style);
  }
  return mergedStrokes(edges);
}
