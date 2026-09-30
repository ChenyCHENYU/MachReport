import type {
  ComponentStyle,
  PlanComponent,
  PlanGrid,
  PlanPage,
  RenderPlan
} from "../schema/render-plan";
import { RENDER_PLAN_SCHEMA_VERSION } from "../schema/render-plan";
import { DEFAULT_FONT_PT, LINE_HEIGHT } from "../defaults";
import { heuristicMeasurer, measureTextMm, wrapText, type TextMeasurer } from "./textwrap";

export interface ListColumn {
  header: string;
  field: string;
  widthMm: number;
  style?: ComponentStyle;
}

export interface ListComponent {
  kind: "list";
  id?: string;
  leftMm: number;
  topMm: number;
  widthMm: number;
  dataset: string;
  columns: ListColumn[];
  fontSizePt?: number;
  headerBold?: boolean;
  rowHeightMm?: number;
  paddingMm?: number;
  headerEveryPage?: boolean;
  headerBackgroundColor?: string;
  border?: boolean;
}

export type TemplateComponent = PlanComponent | ListComponent;

export interface TemplatePage {
  widthMm: number;
  heightMm: number;
  marginTopMm?: number;
  marginBottomMm?: number;
  marginLeftMm?: number;
  marginRightMm?: number;
  components: TemplateComponent[];
}

export interface ReportTemplate {
  schemaVersion?: string;
  pages: TemplatePage[];
}

export type DatasetRows = Record<string, Record<string, unknown>[]>;

export interface PaginateOptions {
  /** 每行额外占高（mm），压测专用钩子 */
  mmPerRow?: number;
  /** 文本测量器（默认启发式；浏览器端可注入 canvas 测量校准） */
  measurer?: TextMeasurer;
}

export interface PaginateResult {
  plan: RenderPlan;
  warnings: string[];
}

interface WorkingPage {
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  components: PlanComponent[];
}

function makeWorkingPage(page: TemplatePage): WorkingPage {
  return {
    widthMm: page.widthMm,
    heightMm: page.heightMm,
    marginTopMm: page.marginTopMm ?? 0,
    marginBottomMm: page.marginBottomMm ?? 0,
    marginLeftMm: page.marginLeftMm ?? 0,
    marginRightMm: page.marginRightMm ?? 0,
    components: []
  };
}

function toContentBottom(page: TemplatePage, wp: WorkingPage): number {
  return wp.heightMm - (page.marginBottomMm ?? wp.marginBottomMm);
}

function estRowHeightMm(list: ListComponent, lines: number): number {
  const fontSizePt = list.fontSizePt ?? DEFAULT_FONT_PT;
  const lineMm = (fontSizePt * LINE_HEIGHT * 25.4) / 72;
  const padding = (list.paddingMm ?? 1) * 2;
  return Math.max(list.rowHeightMm ?? 0, lines * lineMm + padding);
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 列表级驻留产物：热路径（万行循环）中不再逐行/逐格新建样式对象 */
interface ListInterning {
  fontSizePt: number;
  paddingMm: number;
  /** 每列常驻单元格样式引用（同列所有行共享同一对象） */
  cellStyles: (ComponentStyle | undefined)[];
  /** 列表整体边框样式（所有行/表头共享） */
  borderStyle: ComponentStyle;
  headerHeightMm: number;
  headerGrid: PlanGrid;
  columns: ListColumn[];
}

type GridCellCompat = {
  text?: string;
  colSpan?: number;
  rowSpan?: number;
  style?: ComponentStyle;
};

function interList(list: ListComponent, measurer: TextMeasurer): ListInterning {
  const fontSizePt = list.fontSizePt ?? DEFAULT_FONT_PT;
  const paddingMm = list.paddingMm ?? 1;

  // 每列单元格样式只构造一次：{ align, verticalAlign, ...col.style }
  const cellStyles = list.columns.map((col) =>
    col.style
      ? ({ align: "left", verticalAlign: "middle", ...col.style } as ComponentStyle)
      : ({ align: "left", verticalAlign: "middle" } as ComponentStyle)
  );

  // 表头单元格样式（含底色/加粗），同样驻留
  const headerCellStyles = list.columns.map((col) =>
    ({
      bold: list.headerBold ?? true,
      align: "center",
      verticalAlign: "middle",
      backgroundColor: list.headerBackgroundColor,
      ...(col.style || {})
    }) as ComponentStyle
  );

  const headerTexts = list.columns.map((col) => col.header);
  const headerLines = headerTexts.map((text, i) =>
    wrapText(
      text,
      list.columns[i]!.widthMm - paddingMm * 2,
      { fontSizePt, bold: list.headerBold ?? true },
      measurer
    )
  );
  const maxLines = Math.max(...headerLines.map((l) => l.length), 1);
  const headerHeight = estRowHeightMm(list, maxLines);

  const headerCells: GridCellCompat[] = headerTexts.map((text, i) => ({
    text,
    style: headerCellStyles[i]
  }));

  // border:false → 四边全关（下游 resolveBoxBorders 据此不画内外线）
  const borderStyle: ComponentStyle =
    list.border === false
      ? { borderTop: false, borderRight: false, borderBottom: false, borderLeft: false }
      : { borderBottom: true, borderLeft: true, borderRight: true, borderTop: true };

  return {
    fontSizePt,
    paddingMm,
    cellStyles,
    borderStyle,
    headerHeightMm: headerHeight,
    headerGrid: { cells: [headerCells as GridCellCompat[]], rowHeightsMm: [headerHeight] },
    columns: list.columns
  };
}

interface ListInterningWithFloor extends ListInterning {
  rowHeightFloorMm: number;
}

/** 单行 → 网格（复用驻留样式，无逐格对象分配） */
function buildRowGridFast(
  inter: ListInterningWithFloor,
  row: Record<string, unknown>,
  measurer: TextMeasurer
): { grid: PlanGrid; heightMm: number } {
  const columns = inter.columns;
  const texts: string[] = new Array(columns.length);
  let maxLines = 1;
  for (let i = 0; i < columns.length; i++) {
    texts[i] = cellText(row[columns[i]!.field]);
  }
  // 折行只需算一次行数（宽度/字号同列恒定）
  const lines: string[][] = new Array(columns.length);
  for (let i = 0; i < columns.length; i++) {
    const wrapped = wrapText(
      texts[i]!,
      columns[i]!.widthMm - inter.paddingMm * 2,
      { fontSizePt: inter.fontSizePt },
      measurer
    );
    lines[i] = wrapped;
    if (wrapped.length > maxLines) maxLines = wrapped.length;
  }
  const lineMm = (inter.fontSizePt * LINE_HEIGHT * 25.4) / 72;
  const height = Math.max(
    inter.rowHeightFloorMm,
    maxLines * lineMm + inter.paddingMm * 2
  );
  const cells: GridCellCompat[] = new Array(columns.length);
  for (let i = 0; i < columns.length; i++) {
    cells[i] = { text: texts[i]!, style: inter.cellStyles[i] };
  }
  return { grid: { cells: [cells], rowHeightsMm: [height] }, heightMm: height };
}

export function paginateTemplate(
  template: ReportTemplate,
  datasets: DatasetRows,
  optionsOrMmPerRow: number | PaginateOptions = {}
): PaginateResult {
  // 兼容旧签名 paginateTemplate(tpl, data, mmPerRow: number)
  const options: PaginateOptions =
    typeof optionsOrMmPerRow === "number" ? { mmPerRow: optionsOrMmPerRow } : optionsOrMmPerRow;
  const mmPerRow = options.mmPerRow ?? 0;
  const measurer = options.measurer ?? heuristicMeasurer;
  const warnings: string[] = [];
  const pages: PlanPage[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}_${(++seq).toString(36)}`;

  for (const tplPage of template.pages) {
    const current = makeWorkingPage(tplPage);
    const contentBottom = () => toContentBottom(tplPage, current);
    const contentTop = current.marginTopMm;
    const pushCurrent = () => {
      pages.push({
        pageWidthMm: current.widthMm,
        pageHeightMm: current.heightMm,
        marginTopMm: current.marginTopMm,
        marginBottomMm: current.marginBottomMm,
        marginLeftMm: current.marginLeftMm,
        marginRightMm: current.marginRightMm,
        components: current.components
      });
    };

    for (const comp of tplPage.components) {
      if (comp.kind !== "list") {
        current.components.push(comp as PlanComponent);
        continue;
      }
      const list = comp;
      const rows = datasets[list.dataset];
      if (!Array.isArray(rows)) {
        warnings.push(`数据集 ${list.dataset} 未提供数据，列表 ${list.id ?? ""} 输出为空`);
      }
      const dataRows = Array.isArray(rows) ? rows : [];

      const columnsWidth = list.columns.reduce((s, c) => s + c.widthMm, 0);
      const scale = columnsWidth > list.widthMm ? list.widthMm / columnsWidth : 1;
      const scaledList: ListComponent =
        scale === 1 ? list : { ...list, columns: list.columns.map((c) => ({ ...c, widthMm: c.widthMm * scale })) };

      const inter: ListInterningWithFloor = {
        ...interList(scaledList, measurer),
        rowHeightFloorMm: scaledList.rowHeightMm ?? 0
      };

      const headerComp: PlanComponent = {
        kind: "rect",
        leftMm: list.leftMm,
        topMm: 0,
        widthMm: list.widthMm,
        heightMm: inter.headerHeightMm,
        grid: inter.headerGrid,
        nid: nextId("listh"),
        style: inter.borderStyle
      };

      let y = list.topMm;
      const placeHeader = (target: WorkingPage, topMm: number) => {
        target.components.push({ ...headerComp, topMm });
      };

      placeHeader(current, y);
      y += inter.headerHeightMm + mmPerRow;

      for (let i = 0; i < dataRows.length; i++) {
        const rowGrid = buildRowGridFast(inter, dataRows[i]!, measurer);
        if (y + rowGrid.heightMm > contentBottom()) {
          pushCurrent();
          const next = makeWorkingPage(tplPage);
          current.components = next.components;
          current.heightMm = next.heightMm;
          if (scaledList.headerEveryPage !== false) {
            placeHeader(current, list.topMm);
            y = list.topMm + inter.headerHeightMm;
          } else {
            y = contentTop;
          }
        }
        current.components.push({
          kind: "rect",
          leftMm: list.leftMm,
          topMm: y,
          widthMm: list.widthMm,
          heightMm: rowGrid.heightMm,
          grid: rowGrid.grid,
          nid: nextId("listr"),
          style: inter.borderStyle
        });
        y += rowGrid.heightMm;
      }
    }
    pushCurrent();
  }

  return {
    plan: { schemaVersion: RENDER_PLAN_SCHEMA_VERSION, pages },
    warnings
  };
}

export { measureTextMm, wrapText };
