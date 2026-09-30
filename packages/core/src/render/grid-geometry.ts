import type { GridCell, PlanGrid } from "../schema/render-plan";

export interface GridCellBox {
  ri: number;
  ci: number;
  cell: GridCell;
  /** 相对组件左上角（mm，顶点原点） */
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

/** 网格线段：kind="h" 为水平线（pos=y，from/to=x 区间）；"v" 为垂直线（pos=x，from/to=y 区间） */
export interface GridEdge {
  kind: "h" | "v";
  pos: number;
  from: number;
  to: number;
}

export interface GridLayout {
  columns: { pos: number; size: number }[];
  rows: { pos: number; size: number }[];
  cells: GridCellBox[];
  /** 内部网格线段（不含外框；已跳过被 colSpan/rowSpan 跨越的边界，相邻段已合并） */
  edges: GridEdge[];
}

function cumulate(sizesMm: number[], totalMm: number): { pos: number; size: number }[] {
  const n = sizesMm.length;
  if (n === 0) return [];
  const sum = sizesMm.reduce((s, v) => s + v, 0);
  const scale = sum > 0 && totalMm > 0 ? totalMm / sum : 1;
  const out: { pos: number; size: number }[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const size = Math.max(0, sizesMm[i]! * scale);
    out.push({ pos: acc, size });
    acc += size;
  }
  return out;
}

/**
 * 网格几何统一解析（DOM/Canvas/PDF 三后端共用，单位真相源）：
 * - 列宽：优先 colWidthsMm（等比缩放至组件宽），否则按列数均分
 * - 行高：优先 rowHeightsMm（等比缩放至组件高），否则按行数均分
 * - colSpan/rowSpan：占位矩阵展开，跨度取起止行列差；越界收敛到网格内
 * - 行内 null/undefined 单元格视为占 1 列的空单元格（与 DOM 表格行为一致）
 * - edges：内部网格线段，跳过被 span 跨越的边界（合并单元格中间无线）
 * 产出为组件左上角顶点原点的 mm 坐标，各后端自行换算 px/pt。
 */
export function resolveGridLayout(
  grid: PlanGrid,
  compWidthMm: number,
  compHeightMm: number
): GridLayout {
  const rowsRaw = grid.cells ?? [];
  const rowCount = Math.max(rowsRaw.length, 1);
  const colCount =
    grid.colWidthsMm?.length ??
    Math.max(1, ...rowsRaw.map((r) => (Array.isArray(r) ? r.length : 0)));

  const widths = grid.colWidthsMm?.length
    ? cumulate(grid.colWidthsMm, compWidthMm)
    : Array.from({ length: colCount }, (_, i) => ({
        pos: (compWidthMm * i) / colCount,
        size: compWidthMm / colCount
      }));
  const colPos = (ci: number): number =>
    ci <= 0
      ? 0
      : ci >= colCount
        ? widths[widths.length - 1]!.pos + widths[widths.length - 1]!.size
        : widths[ci]!.pos;

  const heights = grid.rowHeightsMm?.length
    ? cumulate(grid.rowHeightsMm, compHeightMm)
    : Array.from({ length: rowCount }, (_, i) => ({
        pos: (compHeightMm * i) / rowCount,
        size: compHeightMm / rowCount
      }));
  const rowPos = (ri: number): number =>
    ri <= 0
      ? 0
      : ri >= rowCount
        ? heights[heights.length - 1]!.pos + heights[heights.length - 1]!.size
        : heights[ri]!.pos;

  const occupied = new Set<string>();
  const key = (r: number, c: number) => `${r}:${c}`;
  const cells: GridCellBox[] = [];

  // 被跨度抑制的边界：vBridge 列边界 c 在行区间 [r1,r2) 内不画线；hBridge 行边界 r 在列区间 [c1,c2) 内不画线
  const vBridge = new Set<string>();
  const hBridge = new Set<string>();
  const vKey = (c: number, r: number) => `v${c}:${r}`;
  const hKey = (r: number, c: number) => `h${r}:${c}`;

  rowsRaw.forEach((row, ri) => {
    if (!Array.isArray(row)) return;
    let ci = 0;
    for (const cell of row) {
      while (ci < colCount && occupied.has(key(ri, ci))) ci++;
      if (ci >= colCount) break;
      const colSpan = Math.max(1, Math.min(cell?.colSpan ?? 1, colCount - ci));
      const rowSpan = Math.max(1, cell?.rowSpan ?? 1);
      const rowEnd = Math.min(rowCount, ri + rowSpan);
      const colEnd = Math.min(colCount, ci + colSpan);
      for (let dr = ri; dr < rowEnd; dr++) {
        for (let dc = ci; dc < colEnd; dc++) {
          occupied.add(key(dr, dc));
        }
      }
      // 跨度内部边界登记为"桥"（该区间不画分隔线）
      for (let c = ci + 1; c < colEnd; c++) {
        for (let r = ri; r < rowEnd; r++) vBridge.add(vKey(c, r));
      }
      for (let r = ri + 1; r < rowEnd; r++) {
        for (let c = ci; c < colEnd; c++) hBridge.add(hKey(r, c));
      }
      const xMm = colPos(ci);
      const yMm = rowPos(ri);
      cells.push({
        ri,
        ci,
        cell: cell ?? {},
        xMm,
        yMm,
        widthMm: colPos(colEnd) - xMm,
        heightMm: rowPos(rowEnd) - yMm
      });
      ci = colEnd;
    }
  });

  // 由占用矩阵直接推导边界（未被任何单元格覆盖的位置同样视为有线，保持闭合）
  const edges: GridEdge[] = [];
  // 垂直内线：列边界 c ∈ [1, colCount-1]，逐行扫描可画区间后合并
  for (let c = 1; c < colCount; c++) {
    let runStart = -1;
    for (let r = 0; r <= rowCount; r++) {
      const open = r < rowCount && !vBridge.has(vKey(c, r));
      if (open && runStart < 0) runStart = r;
      if (!open && runStart >= 0) {
        edges.push({ kind: "v", pos: colPos(c), from: rowPos(runStart), to: rowPos(r) });
        runStart = -1;
      }
    }
  }
  // 水平内线：行边界 r ∈ [1, rowCount-1]
  for (let r = 1; r < rowCount; r++) {
    let runStart = -1;
    for (let c = 0; c <= colCount; c++) {
      const open = c < colCount && !hBridge.has(hKey(r, c));
      if (open && runStart < 0) runStart = c;
      if (!open && runStart >= 0) {
        edges.push({ kind: "h", pos: rowPos(r), from: colPos(runStart), to: colPos(c) });
        runStart = -1;
      }
    }
  }

  return { columns: widths, rows: heights, cells, edges };
}
