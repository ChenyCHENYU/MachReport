import type {
  ComponentStyle,
  PlanComponent,
  PlanGrid,
  PlanPage,
  RichParagraph,
  RenderPlan
} from "../schema/render-plan";
import { isImageBackedComponent, isRichText } from "../schema/render-plan";
import { mmToPx, round } from "../units";
import { resolveGridLayout, type GridCellBox, type GridLayout } from "./grid-geometry";
import { resolveGridStrokes } from "./grid-strokes";
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_COLOR } from "../defaults";
import { reportOutputDiagnostics, type OutputDiagnosticOptions } from "../output/capabilities";
import {
  mergeComponentStyles,
  resolveBoxBorders,
  resolveFontSize,
  resolveLineHeight,
  resolveStroke
} from "./style";

export interface RenderOptions extends OutputDiagnosticOptions {
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

/** Reset only renderer-owned nodes; host element selectors cannot change report geometry. */
function elementStyle(display: string, reset = "unset"): StyleBag {
  return new StyleBag().add("all", reset).add("display", display).add("box-sizing", "border-box");
}

function applyTypography(bag: StyleBag, s: ComponentStyle, dpi: number): void {
  bag
    .add("color", s.color)
    .add("font-family", s.fontFamily)
    .add("font-weight", s.bold != null ? (s.bold ? "700" : "400") : undefined)
    .add("font-style", s.italic != null ? (s.italic ? "italic" : "normal") : undefined)
    .add("text-decoration", s.underline != null ? (s.underline ? "underline" : "none") : undefined)
    .add("letter-spacing", s.letterSpacing != null ? `${s.letterSpacing}pt` : undefined)
    .add("line-height", String(resolveLineHeight(s)))
    .add("text-align", s.align);

  const font = resolveFontSize(s, dpi);
  bag.add("font-size", `${round(font.fontSizePx, 2)}px`);
}

function applyComponentStyle(bag: StyleBag, comp: PlanComponent, dpi: number): void {
  const s = comp.style ?? {};
  applyTypography(bag, s, dpi);
  bag.add("background-color", s.backgroundColor)
    .add("opacity", s.opacity != null ? String(s.opacity) : undefined)
    .add("transform", s.rotateDeg ? `rotate(${s.rotateDeg}deg)` : undefined);
}

function renderGridCell(
  box: GridCellBox,
  comp: PlanComponent,
  paddingMm: number,
  dpi: number,
  options: RenderOptions,
  doc: Document
): HTMLElement {
  const cell = box.cell;
  const cellEl = doc.createElement("td");
  cellEl.className = classOf("cell", options);
  cellEl.dataset.mrRowIndex = String(box.ri);
  cellEl.dataset.mrColumnIndex = String(box.ci);
  cellEl.setAttribute("role", comp.table?.role === "header" ? "columnheader" : "cell");
  if (cell.colSpan) cellEl.colSpan = cell.colSpan;
  if (cell.rowSpan) cellEl.rowSpan = cell.rowSpan;
  const style = mergeComponentStyles(comp.style, cell.style);
  const cellBag = elementStyle("block")
    .add("position", "absolute")
    .mm("left", box.xMm, dpi).mm("top", box.yMm, dpi)
    .mm("width", box.widthMm, dpi).mm("height", box.heightMm, dpi)
    .add("background-color", style.backgroundColor)
    .add("vertical-align", style.verticalAlign ?? "middle");
  applyTypography(cellBag, style, dpi);
  cellBag.applyTo(cellEl);

  // Content cannot contribute native table min-content sizes and enlarge the planned row.
  const payload = doc.createElement("div");
  payload.className = "mr-cell-content";
  elementStyle("flex").add("position", "absolute")
    .mm("left", paddingMm, dpi).mm("right", paddingMm, dpi)
    .mm("top", paddingMm, dpi).mm("bottom", paddingMm, dpi)
    .add("flex-direction", "column")
    .add("justify-content", style.verticalAlign === "top" ? "flex-start" : style.verticalAlign === "bottom" ? "flex-end" : "center")
    .add("overflow-wrap", "anywhere")
    .add("overflow", "hidden")
    .applyTo(payload);
  if (cell.text != null) payload.append(cell.text);
  for (const child of cell.children ?? []) payload.appendChild(renderComponent(child, dpi, options, doc));
  cellEl.appendChild(payload);
  return cellEl;
}

function renderGridEdges(layout: GridLayout, comp: PlanComponent, dpi: number, doc: Document): HTMLElement[] {
  return resolveGridStrokes(layout, comp).map((edge) => {
    const border = `${round((edge.widthPt * dpi) / 72, 2)}px solid ${edge.color}`;
    const line = doc.createElement("div");
    line.className = "mr-grid-edge";
    line.setAttribute("aria-hidden", "true");
    const horizontal = edge.kind === "h";
    elementStyle("block").add("position", "absolute").add("pointer-events", "none")
      .mm("left", horizontal ? edge.from : edge.pos, dpi)
      .mm("top", horizontal ? edge.pos : edge.from, dpi)
      .mm("width", horizontal ? edge.to - edge.from : 0, dpi)
      .mm("height", horizontal ? 0 : edge.to - edge.from, dpi)
      .add(horizontal ? "border-top" : "border-left", border)
      .applyTo(line);
    return line;
  });
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
  table.setAttribute("role", "table");
  elementStyle("block").add("position", "relative")
    .add("width", "100%").add("height", "100%")
    .applyTo(table);
  const layout = resolveGridLayout(grid, comp.widthMm, comp.heightMm);
  const body = doc.createElement("tbody");
  elementStyle("contents").applyTo(body);
  table.appendChild(body);
  const rows = grid.cells.map(() => {
    const row = doc.createElement("tr");
    row.className = classOf("row", options);
    row.setAttribute("role", "row");
    elementStyle("contents").applyTo(row);
    body.appendChild(row);
    return row;
  });
  for (const box of layout.cells) {
    rows[box.ri]!.appendChild(renderGridCell(box, comp, grid.paddingMm ?? 0.5, dpi, options, doc));
  }
  const content = doc.createElement("div");
  elementStyle("block").add("position", "relative").add("width", "100%").add("height", "100%").applyTo(content);
  // Keep decorative edges outside table: HTML serialization/printing must not foster-parent invalid children.
  content.append(table, ...renderGridEdges(layout, comp, dpi, doc));
  return content;
}

function renderRichParagraph(
  para: RichParagraph,
  dpi: number,
  options: RenderOptions,
  doc: Document
): HTMLElement {
  const p = doc.createElement("div");
  p.className = classOf("paragraph", options);
  elementStyle("block")
    .add("text-align", para.align)
    .add("line-height", para.lineHeight != null ? String(para.lineHeight) : undefined)
    .mm("margin-top", para.spaceBeforeMm ?? 0, dpi)
    .mm("margin-bottom", para.spaceAfterMm ?? 0, dpi)
    .mm("text-indent", para.indentMm ?? 0, dpi)
    .applyTo(p);
  for (const seg of para.segments || []) {
    const segEl = doc.createElement("span");
    segEl.className = classOf("segment", options);
    segEl.textContent = seg.kind === "field" ? (seg.field ?? "") : (seg.text ?? "");
    const segBag = elementStyle("inline");
    // An unstyled run inherits the paragraph's font rather than resetting to the engine default.
    if (seg.style) {
      const st = seg.style;
      segBag.add("color", st.color).add("font-family", st.fontFamily)
        .add("font-weight", st.bold != null ? (st.bold ? "700" : "400") : undefined)
        .add("font-style", st.italic != null ? (st.italic ? "italic" : "normal") : undefined)
        .add("text-decoration", st.underline != null ? (st.underline ? "underline" : "none") : undefined);
      if (st.fontSize != null || st.fontSizePx != null) {
        segBag.add("font-size", `${round(resolveFontSize(st, dpi).fontSizePx, 2)}px`);
      }
    }
    segBag.applyTo(segEl);
    p.appendChild(segEl);
  }
  return p;
}

function renderTextContent(comp: PlanComponent, dpi: number, options: RenderOptions, doc: Document): HTMLElement | string {
  if (isRichText(comp)) {
    const richBox = doc.createElement("div");
    richBox.className = classOf("rich", options);
    elementStyle("block").applyTo(richBox);
    for (const para of comp.richParagraphs!) richBox.appendChild(renderRichParagraph(para, dpi, options, doc));
    return richBox;
  }
  if (Array.isArray(comp.lines) && comp.lines.length > 0) {
    const box = doc.createElement("div");
    box.className = classOf("lines", options);
    elementStyle("block").applyTo(box);
    for (const line of comp.lines) {
      const lineEl = doc.createElement("div");
      lineEl.className = classOf("line", options);
      lineEl.textContent = line;
      // Precomputed empty lines must keep their line box, and cannot be rewrapped by the browser.
      elementStyle("block").add("white-space", "pre").add("min-height", "1lh").applyTo(lineEl);
      box.appendChild(lineEl);
    }
    return box;
  }
  return comp.text ?? "";
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
  elementStyle("flex")
    .add("width", "100%")
    .add("height", "100%")
    .add("flex-direction", "column")
    .add("justify-content", s.verticalAlign === "middle" ? "center" : s.verticalAlign === "bottom" ? "flex-end" : "flex-start")
    .add("overflow-wrap", "anywhere")
    .add("overflow", "hidden")
    .applyTo(el);
  el.append(renderTextContent(comp, dpi, options, doc));
  return el;
}

function renderImage(comp: PlanComponent, options: RenderOptions, doc: Document): HTMLElement {
  const img = doc.createElement("img");
  img.className = classOf("image", options);
  img.src = comp.imageData!;
  elementStyle("block")
    .add("width", "100%")
    .add("height", "100%")
    .add("object-fit", "contain")
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
  const bag = elementStyle("block");
  // Grid edges are drawn once from shared geometry; CSS borders must not shrink its content box.
  if (comp.grid) {
    bag.add("position", "relative");
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

function renderDirectedLine(comp: PlanComponent, dpi: number, doc: Document): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  const width = mmToPx(comp.widthMm, dpi);
  const height = mmToPx(comp.heightMm, dpi);
  svg.setAttribute("width", String(Math.max(1, width)));
  svg.setAttribute("height", String(Math.max(1, height)));
  svg.setAttribute("aria-hidden", "true");
  svg.style.overflow = "visible";
  svg.style.display = "block";
  const line = doc.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", "0");
  line.setAttribute("x2", String(width));
  line.setAttribute("y1", comp.lineDirection === "up" ? String(height) : "0");
  line.setAttribute("y2", comp.lineDirection === "up" ? "0" : String(height));
  const stroke = resolveStroke({ ...comp.style, borderColor: comp.style?.lineColor ?? comp.style?.borderColor });
  line.setAttribute("stroke", stroke.color);
  line.setAttribute("stroke-width", String(stroke.widthPt * dpi / 72));
  svg.appendChild(line);
  return svg;
}

export function renderComponent(
  comp: PlanComponent,
  dpi: number,
  options: RenderOptions,
  doc: Document
): HTMLElement {
  const wrap = doc.createElement("div");
  wrap.className = `${classOf("comp", options)} mr-kind-${comp.kind}`;
  const bag = elementStyle("block")
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
  if (comp.kind === "line" && comp.lineDirection) {
    wrap.appendChild(renderDirectedLine(comp, dpi, doc));
    return wrap;
  }
  if (comp.kind === "line" || comp.kind === "rect" || comp.kind === "ellipse") {
    wrap.appendChild(renderShape(comp, dpi, options, doc));
    return wrap;
  }
  const ph = doc.createElement("div");
  ph.className = classOf("unknown", options);
  elementStyle("block").applyTo(ph);
  ph.textContent = comp.fallbackText ?? `[${comp.kind}]`;
  ph.dataset.mrUnsupported = comp.kind;
  ph.setAttribute("role", "note");
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
  elementStyle("block", "initial")
    .add("position", "relative")
    .add("font-family", DEFAULT_FONT_FAMILY)
    .add("font-size", `${round(resolveFontSize(undefined, dpi).fontSizePx, 2)}px`)
    .add("line-height", String(resolveLineHeight(undefined)))
    .add("white-space", "pre-wrap")
    .add("direction", "ltr")
    .mm("width", page.pageWidthMm, dpi)
    .mm("height", page.pageHeightMm, dpi)
    .add("background-color", "#fff")
    .add("color", DEFAULT_TEXT_COLOR)
    .add("overflow", "hidden")
    .add("box-sizing", "border-box")
    .applyTo(el);
  page.components.forEach((comp, componentIndex) => {
    const element = renderComponent(comp, dpi, options, doc);
    element.dataset.mrComponentIndex = String(componentIndex);
    el.appendChild(element);
  });
  return el;
}

export function renderPlan(
  plan: RenderPlan,
  doc: Document,
  options: RenderOptions = {}
): HTMLElement {
  const dpi = options.dpi ?? 96;
  reportOutputDiagnostics(plan, "dom", options);
  const root = doc.createElement("div");
  root.className = classOf("root", options);
  elementStyle("block").applyTo(root);
  root.dataset.schemaVersion = plan.schemaVersion;
  plan.pages.forEach((page) => {
    root.appendChild(renderPage(page, dpi, options, doc));
  });
  return root;
}
