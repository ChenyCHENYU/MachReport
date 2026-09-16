import type {
  PlanComponent,
  PlanGrid,
  PlanPage,
  RenderPlan
} from "../schema/render-plan";
import { isImageBackedComponent, isRichText } from "../schema/render-plan";
import { mmToPx, round } from "../units";

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

class StyleBag {
  private parts: string[] = [];
  add(prop: string, value: string | number | undefined | null | false): this {
    if (value === undefined || value === null || value === false || value === "") return this;
    this.parts.push(`${prop}:${value}`);
    return this;
  }
  mm(prop: string, valueMm: number, dpi: number, digits = 2): this {
    return this.add(prop, `${round(mmToPx(valueMm, dpi), digits)}px`);
  }
  toString(): string {
    return this.parts.join(";");
  }
  applyTo(el: HTMLElement): void {
    const css = this.toString();
    if (css) el.style.cssText += `${el.style.cssText && !el.style.cssText.endsWith(";") ? ";" : ""}${css}`;
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
  if (s.fontSizePx != null) bag.add("font-size", `${s.fontSizePx}px`);
  else if (s.fontSize != null) bag.add("font-size", `${round((s.fontSize * dpi) / 72, 2)}px`);
}

function renderGrid(
  grid: PlanGrid,
  dpi: number,
  options: RenderOptions,
  doc: Document
): HTMLElement {
  const table = doc.createElement("table");
  table.className = classOf("grid", options);
  new StyleBag()
    .add("width", "100%")
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
  for (const row of grid.cells) {
    const rowEl = doc.createElement("tr");
    rowEl.className = classOf("row", options);
    (row || []).forEach((cell) => {
      const cellEl = doc.createElement("td");
      cellEl.className = classOf("cell", options);
      if (cell?.colSpan) cellEl.colSpan = cell.colSpan;
      if (cell?.rowSpan) cellEl.rowSpan = cell.rowSpan;
      if (cell?.style) {
        const st = cell.style;
        const cellBag = new StyleBag()
          .add("text-align", st.align)
          .add("vertical-align", st.verticalAlign)
          .add("background-color", st.backgroundColor)
          .add("color", st.color)
          .add("font-weight", st.bold ? "700" : undefined);
        if (st.fontSizePx != null) cellBag.add("font-size", `${st.fontSizePx}px`);
        else if (st.fontSize != null) {
          cellBag.add("font-size", `${round((st.fontSize * dpi) / 72, 2)}px`);
        }
        cellBag.applyTo(cellEl);
      }
      if (cell?.text != null) cellEl.textContent = cell.text;
      if (cell?.children?.length) {
        for (const child of cell.children) {
          cellEl.appendChild(renderComponent(child, dpi, options, doc));
        }
      }
      rowEl.appendChild(cellEl);
    });
    table.appendChild(rowEl);
  }
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
  applyComponentStyle(new StyleBag(), comp, dpi);
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
  bag.applyTo(el);
  applyComponentStyle(bag, comp, dpi);

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
          if (seg.style.fontSizePx != null) segBag.add("font-size", `${seg.style.fontSizePx}px`);
          else if (seg.style.fontSize != null) {
            segBag.add("font-size", `${round((seg.style.fontSize * dpi) / 72, 2)}px`);
          }
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
  const border = `${round(((s.lineWidthPt ?? 0.75) * dpi) / 72, 2)}px solid ${s.lineColor ?? s.borderColor ?? "#333"}`;
  const bag = new StyleBag();
  if (comp.kind === "rect") {
    bag.add("border", border);
  } else if (comp.kind === "ellipse") {
    bag.add("border", border).add("border-radius", "50%");
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
  bag.applyTo(wrap);
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
    shape.appendChild(renderGrid(comp.grid, dpi, options, doc));
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
