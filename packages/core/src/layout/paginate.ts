import type {
  ComponentStyle,
  PlanComponent,
  PlanGrid,
  PlanPage,
  RenderPlan
} from "../schema/render-plan";
import { RENDER_PLAN_SCHEMA_VERSION } from "../schema/render-plan";
import { measureTextMm, wrapText } from "./textwrap";

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

export interface PaginateResult {
  plan: RenderPlan;
  warnings: string[];
}

interface WorkingPage {
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  components: PlanComponent[];
}

function pageContentHeight(page: TemplatePage): number {
  const top = page.marginTopMm ?? 0;
  const bottom = page.marginBottomMm ?? 0;
  return page.heightMm - top - bottom;
}

function makeWorkingPage(page: TemplatePage): WorkingPage {
  return {
    widthMm: page.widthMm,
    heightMm: page.heightMm,
    marginTopMm: page.marginTopMm ?? 0,
    marginBottomMm: page.marginBottomMm ?? 0,
    components: []
  };
}

function toContentBottom(page: TemplatePage, wp: WorkingPage): number {
  return wp.heightMm - (page.marginBottomMm ?? wp.marginBottomMm);
}

function estRowHeightMm(list: ListComponent, lines: number): number {
  const fontSizePt = list.fontSizePt ?? 10.5;
  const lineMm = (fontSizePt * 1.35 * 25.4) / 72;
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

function buildHeaderGrid(list: ListComponent): { grid: PlanGrid; heightMm: number } {
  const fontSizePt = list.fontSizePt ?? 10.5;
  const cells = list.columns.map((col) => ({
    text: col.header,
    style: {
      bold: list.headerBold ?? true,
      align: "center" as const,
      verticalAlign: "middle" as const,
      backgroundColor: list.headerBackgroundColor,
      ...(col.style || {})
    }
  }));
  const lines = list.columns.map((col) =>
    wrapText(col.header, col.widthMm - (list.paddingMm ?? 1) * 2, {
      fontSizePt,
      bold: list.headerBold ?? true
    })
  );
  const maxLines = Math.max(...lines.map((l) => l.length), 1);
  const height = estRowHeightMm(list, maxLines);
  return {
    grid: { cells: [cells], rowHeightsMm: [height] },
    heightMm: height
  };
}

function buildRowGrid(
  list: ListComponent,
  row: Record<string, unknown>
): { grid: PlanGrid; heightMm: number } {
  const fontSizePt = list.fontSizePt ?? 10.5;
  const cells = list.columns.map((col) => ({
    text: cellText(row[col.field]),
    style: { align: "left" as const, verticalAlign: "middle" as const, ...(col.style || {}) }
  }));
  const lines = list.columns.map((col) =>
    wrapText(cellText(row[col.field]), col.widthMm - (list.paddingMm ?? 1) * 2, {
      fontSizePt
    })
  );
  const maxLines = Math.max(...lines.map((l) => l.length), 1);
  const height = estRowHeightMm(list, maxLines);
  return {
    grid: { cells: [cells], rowHeightsMm: [height] },
    heightMm: height
  };
}

function gridStyleOverride(list: ListComponent): ComponentStyle {
  return list.border === false ? {} : { borderBottom: true, borderLeft: true, borderRight: true, borderTop: true };
}

export function paginateTemplate(
  template: ReportTemplate,
  datasets: DatasetRows,
  mmPerRow = 0
): PaginateResult {
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
      const scaled: ListColumn[] =
        scale === 1
          ? list.columns
          : list.columns.map((c) => ({ ...c, widthMm: c.widthMm * scale }));

      const scaledList: ListComponent = { ...list, columns: scaled };

      const header = buildHeaderGrid(scaledList);
      const headerComp: PlanComponent = {
        kind: "rect",
        leftMm: list.leftMm,
        topMm: 0,
        widthMm: list.widthMm,
        heightMm: header.heightMm,
        grid: header.grid,
        nid: nextId("listh"),
        style: gridStyleOverride(scaledList)
      };

      let y = list.topMm;
      const placeHeader = (target: WorkingPage, topMm: number) => {
        target.components.push({ ...headerComp, topMm });
      };

      placeHeader(current, y);
      y += header.heightMm + (mmPerRow || 0);

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i]!;
        const rowGrid = buildRowGrid(scaledList, row);
        if (y + rowGrid.heightMm > contentBottom()) {
          pushCurrent();
          const next = makeWorkingPage(tplPage);
          current.components = next.components;
          current.heightMm = next.heightMm;
          if (scaledList.headerEveryPage !== false) {
            placeHeader(current, list.topMm);
            y = list.topMm + header.heightMm;
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
          style: gridStyleOverride(scaledList)
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
