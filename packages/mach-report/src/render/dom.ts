import type {
  PlanComponent,
  PlanGrid,
  PlanPage,
  RenderPlan
} from "../schema/render-plan";
import { isImageBackedComponent, isRichText } from "../schema/render-plan";
import { mmToPx, round } from "../units";
import {
  resolveBoxBorders,
  resolveFontSize,
  resolveStroke
} from "./style";

export interface RenderOptions {
  dpi?: number;
  classNames?: Partial<Record<ClassKey, string>>;
}

export type ClassKey =
  | "root"
  | "page"
  | "comp"
  | "text"
  | "lines"
  | "line"
  | "rich"
  | "paragraph"
  | "segment"
  | "image"
  | "shape"
  | "grid"
  | "row"
  | "cell"
  | "unknown";

const CLS: Record<ClassKey, string> = {
  root: "mr-root",
  page: "mr-page",
  comp: "mr-comp",
  text: "mr-text",
  lines: "mr-lines",
  line: "mr-line",
  rich: "mr-rich",
  paragraph: "mr-paragraph",
  segment: "mr-segment",
  image: "mr-image",
  shape: "mr-shape",
  grid: "mr-grid",
  row: "mr-row",
  cell: "mr-cell",
  unknown: "mr-unknown"
};

export function classOf(key: ClassKey, options?: RenderOptions): string {
  return options?.classNames?.[key] ?? CLS[key];
}

type StyleValue = string | number | undefined | null | false;

/**
 * 样式收集器：收集结束一次性赋值写入元素。
 * `cssText = `（整串赋值，非追加）既保持一次 DOM 桥接调用的性能，
 * 又从根上避免旧实现"cssText += 追加语义"导致的重复写入 bug。
 */
class StyleBag {
  private props: [string, string][] = [];
  add(prop: string, value: StyleValue): this {
    if (value === undefined || value === null || value === false || value === "") return this;
    this.props.push([prop, String(value)]);
    return this;
  }
  mm(prop: string, valueMm: number, dpi: number, digits = 2): this {
    return this.add(prop, `${round(mmToPx(valueMm, dpi), digits)}px`);
  }
  toString(): string {
    let css = "";
    for (const [prop, value] of this.props) {
      css += `${prop}:${value};`;
    }
    return css;
  }
  applyTo(el: HTMLElement): void {
    const css = this.toString();
    if (css) el.style.cssText = css;
  }
}

function applyComponentStyle(bag: StyleBag, comp: PlanComponent, dpi: number): void {
  const s = comp.style || {};
  bag
    .add("color", s.color)
    .add("background-color", s.backgroundColor)
    .add("font-family", s.fontFamily)
    .add("font-weight", s.bold ? "700" : undefined)
    .add("font-style", s.italic ? "italic" : undefined)
    .add("text-decoration", s.underline ? "underline" : undefined)
    .add("letter-spacing", s.letterSpacing != null ? `${s.letterSpacing}pt` : undefined)
    .add("opacity", s.opacity != null ? String(s.opacity) : undefined)
    .add("transform", s.rotateDeg ? `rotate(${s.rotateDeg}deg)` : undefined);
  const font = resolveFontSize(s, dpi);
  bag.add("font-size", `${round(font.fontSizePx, 2)}px`);
}

function renderGrid(
  grid: PlanGrid,
  comp: PlanComponent,
  dpi: number,
  options: RenderOptions,
  doc: Document
): HTMLElement {
  const table = doc.createElement("table");
  table.className = classOf("grid", options);
  new StyleBag()
    .add("width", "100%")
    .add("height", "100%")
    .add("border-collapse", "collapse")
    .add("table-layout", grid.colWidthsMm ? "fixed" : "auto")
    .applyTo(table);
  if (grid.colWidthsMm) {
    const colGroup = doc.createElement("colgroup");
    for (const w of grid.colWidthsMm) {
      const col = doc.createElement("col");
      new StyleBag().mm("width", w, dpi).applyTo(col);
      colGroup.appendChild(col);
    }
    table.appendChild(colGroup);
  }
  // 内部网格线由 td 边框承担（border-collapse 下 colSpan/rowSpan 自动正确）
  const borders = resolveBoxBorders(comp.style);
  const stroke = resolveStroke(comp.style);
  const border = borders.inner
    ? `${round((stroke.widthPt * dpi) / 72, 2)}px solid ${stroke.color}`
    : "";

  grid.cells.forEach((row, ri) => {
    const rowEl = doc.createElement("tr");
    rowEl.className = classOf("row", options);
    if (grid.rowHeightsMm?.[ri] != null) {
      new StyleBag().mm("height", grid.rowHeightsMm[ri]!, dpi).applyTo(rowEl);
    }
    (row || []).forEach((cell) => {
      const cellEl = doc.createElement("td");
      cellEl.className = classOf("cell", options);
      if (cell?.colSpan) cellEl.colSpan = cell.colSpan;
      if (cell?.rowSpan) cellEl.rowSpan = cell.rowSpan;
      const cellBag = new StyleBag();
      if (border) cellBag.add("border", border);
      if (cell?.style) {
        const st = cell.style;
        cellBag
          .add("text-align", st.align)
          .add("vertical-align", st.verticalAlign)
          .add("background-color", st.backgroundColor)
          .add("color", st.color)
          .add("font-weight", st.bold ? "700" : undefined);
        cellBag.add("font-size", `${round(resolveFontSize(st, dpi).fontSizePx, 2)}px`);
      }
      cellBag.applyTo(cellEl);
      if (cell?.text != null) cellEl.textContent = cell.text;
      if (cell?.children?.length) {
        for (const child of cell.children) {
          cellEl.appendChild(renderComponent(child, dpi, options, doc));
        }
      }
      rowEl.appendChild(cellEl);
    });
    table.appendChild(rowEl);
  });
  return table;
}

function renderText(
  comp: PlanComponent,
  dpi: number,
  options: RenderOptions,
  doc: Document
): HTMLElement {
  const el = doc.createElement("div");
  el.className = classOf("text", options);
  const s = comp.style || {};
  const bag = new StyleBag()
    .add("text-align", s.align)
    .add("display", "flex")
    .add("flex-direction", "column")
    .add(
      "justify-content",
      s.verticalAlign === "middle" ? "center" : s.verticalAlign === "bottom" ? "flex-end" : "flex-start"
    )
    .add("overflow", "hidden");
  applyComponentStyle(bag, comp, dpi);
  bag.applyTo(el);

  if (isRichText(comp)) {
    const richBox = doc.createElement("div");
    richBox.className = classOf("rich", options);
    for (const para of comp.richParagraphs!) {
      const p = doc.createElement("div");
      p.className = classOf("paragraph", options);
      const pBag = new StyleBag()
        .add("text-align", para.align)
        .add("line-height", para.lineHeight != null ? String(para.lineHeight) : undefined)
        .mm("margin-top", para.spaceBeforeMm ?? 0, dpi)
        .mm("margin-bottom", para.spaceAfterMm ?? 0, dpi)
        .mm("text-indent", para.indentMm ?? 0, dpi);
      pBag.applyTo(p);
      for (const seg of para.segments || []) {
        const segEl = doc.createElement("span");
        segEl.className = classOf("segment", options);
        segEl.textContent = seg.kind === "field" ? (seg.field ?? "") : (seg.text ?? "");
        if (seg.style) {
          const segBag = new StyleBag()
            .add("color", seg.style.color)
            .add("font-weight", seg.style.bold ? "700" : undefined);
          segBag.add("font-size", `${round(resolveFontSize(seg.style, dpi).fontSizePx, 2)}px`);
          segBag.applyTo(segEl);
        }
        p.appendChild(segEl);
      }
      richBox.appendChild(p);
    }
    el.appendChild(richBox);
    return el;
  }
  if (Array.isArray(comp.lines) && comp.lines.length > 0) {
    const box = doc.createElement("div");
    box.className = classOf("lines", options);
    if (s.lineHeight != null) new StyleBag().add("line-height", String(s.lineHeight)).applyTo(box);
    for (const line of comp.lines) {
      const lineEl = doc.createElement("div");
      lineEl.className = classOf("line", options);
      lineEl.textContent = line;
      box.appendChild(lineEl);
    }
    el.appendChild(box);
    return el;
  }
  el.textContent = comp.text ?? "";
  return el;
}

function renderImage(comp: PlanComponent, options: RenderOptions, doc: Document): HTMLElement {
  const img = doc.createElement("img");
  img.className = classOf("image", options);
  img.src = comp.imageData!;
  new StyleBag()
    .add("width", "100%")
    .add("height", "100%")
    .add("object-fit", "contain")
    .add("display", "block")
    .applyTo(img);
  img.alt = comp.kind;
  return img;
}

function renderShape(
  comp: PlanComponent,
  dpi: number,
  options: RenderOptions,
  doc: Document
): HTMLElement {
  const el = doc.createElement("div");
  el.className = classOf("shape", options);
  const s = comp.style || {};
  const stroke = resolveStroke(s);
  const borders = resolveBoxBorders(s);
  const border = `${round((stroke.widthPt * dpi) / 72, 2)}px solid ${stroke.color}`;
  const bag = new StyleBag();
  // 含 grid 的 rect：内线由 td 承担，shape 只画外框四边（按开关）
  if (comp.grid) {
    if (borders.top) bag.add("border-top", border);
    if (borders.right) bag.add("border-right", border);
    if (borders.bottom) bag.add("border-bottom", border);
    if (borders.left) bag.add("border-left", border);
  } else if (comp.kind === "rect") {
    if (borders.top) bag.add("border-top", border);
    if (borders.right) bag.add("border-right", border);
    if (borders.bottom) bag.add("border-bottom", border);
    if (borders.left) bag.add("border-left", border);
  } else if (comp.kind === "ellipse") {
    if (borders.inner) bag.add("border", border).add("border-radius", "50%");
    if (s.backgroundColor) bag.add("background-color", s.backgroundColor);
  } else if (comp.kind === "line") {
    bag.add("height", "0").add("border-top", border);
  }
  bag.add("box-sizing", "border-box").add("width", "100%").add("height", "100%");
  bag.applyTo(el);
  return el;
}

export function renderComponent(
  comp: PlanComponent,
  dpi: number,
  options: RenderOptions,
  doc: Document
): HTMLElement {
  const wrap = doc.createElement("div");
  wrap.className = `${classOf("comp", options)} mr-kind-${comp.kind}`;
  const bag = new StyleBag()
    .add("position", "absolute")
    .mm("left", comp.leftMm, dpi)
    .mm("top", comp.topMm, dpi)
    .mm("width", comp.widthMm, dpi)
    .mm("height", comp.heightMm, dpi)
    .add("box-sizing", "border-box");
  applyComponentStyle(bag, comp, dpi);
  bag.applyTo(wrap);

  if (isImageBackedComponent(comp)) {
    wrap.appendChild(renderImage(comp, options, doc));
    return wrap;
  }
  if (comp.kind === "text") {
    wrap.appendChild(renderText(comp, dpi, options, doc));
    return wrap;
  }
  if (comp.grid) {
    const shape = renderShape(comp, dpi, options, doc);
    shape.appendChild(renderGrid(comp.grid, comp, dpi, options, doc));
    wrap.appendChild(shape);
    return wrap;
  }
  if (comp.kind === "line" || comp.kind === "rect" || comp.kind === "ellipse" || comp.kind === "chart") {
    wrap.appendChild(renderShape(comp, dpi, options, doc));
    return wrap;
  }
  const ph = doc.createElement("div");
  ph.className = classOf("unknown", options);
  ph.textContent = comp.fallbackText ?? "";
  wrap.appendChild(ph);
  return wrap;
}

export function renderPage(
  page: PlanPage,
  dpi: number,
  options: RenderOptions,
  doc: Document
): HTMLElement {
  const el = doc.createElement("div");
  el.className = classOf("page", options);
  new StyleBag()
    .add("position", "relative")
    .mm("width", page.pageWidthMm, dpi)
    .mm("height", page.pageHeightMm, dpi)
    .add("background-color", "#fff")
    .add("overflow", "hidden")
    .add("box-sizing", "border-box")
    .applyTo(el);
  for (const comp of page.components) {
    el.appendChild(renderComponent(comp, dpi, options, doc));
  }
  return el;
}

export function renderPlan(
  plan: RenderPlan,
  doc: Document,
  options: RenderOptions = {}
): HTMLElement {
  const dpi = options.dpi ?? 96;
  const root = doc.createElement("div");
  root.className = classOf("root", options);
  root.dataset.schemaVersion = plan.schemaVersion;
  plan.pages.forEach((page) => {
    root.appendChild(renderPage(page, dpi, options, doc));
  });
  return root;
}
