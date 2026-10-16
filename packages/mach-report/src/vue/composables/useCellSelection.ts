import { nextTick, shallowRef, type Ref } from "vue";
import { createReportCellResolver, formatReportClipboard, getReportCellContext, parseReportClipboard, ReportCellEditError, type RenderPlan, type ReportCellAddress, type ReportCellEdit, type ReportCellInput } from "@agile-team/mach-report";
import { resolveGridLayout } from "../../render/grid-geometry";
import { reportCellAddress } from "./useCellEditing";
import { selectionAddressResolver, selectionCoordinate } from "./selection-grid";

export interface ReportCellSelection { anchor: ReportCellAddress; focus: ReportCellAddress }
export interface ReportFieldTarget { field: string; datasetId?: string; rowKey?: string | number }
interface SelectionHost {
  plan: Ref<RenderPlan | null>;
  root: Ref<HTMLElement | null>;
  enabled(): boolean;
  busy(): boolean;
  differences(): readonly ReportCellEdit[];
  gotoPage(page: number): void;
  edit(cell: HTMLElement): Promise<void>;
  apply(inputs: readonly ReportCellInput[]): Promise<boolean>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  error(cause: unknown): void;
}

function sameGrid(a: ReportCellAddress, b: ReportCellAddress): boolean { return a.pageIndex === b.pageIndex && a.componentIndex === b.componentIndex; }
function sameAddress(a: ReportCellAddress, b: ReportCellAddress): boolean { return sameGrid(a, b) && a.rowIndex === b.rowIndex && a.columnIndex === b.columnIndex; }
function selector(address: ReportCellAddress): string {
  return `[data-page="${address.pageIndex + 1}"] [data-mr-component-index="${address.componentIndex}"] td[data-mr-row-index="${address.rowIndex}"][data-mr-column-index="${address.columnIndex}"]`;
}
function inside(plan: RenderPlan, address: ReportCellAddress, selection: ReportCellSelection): boolean {
  const { anchor, focus } = selection;
  const a = selectionCoordinate(plan, anchor);
  const b = selectionCoordinate(plan, focus, anchor);
  const c = selectionCoordinate(plan, address, anchor);
  return c.grid === a.grid && c.row >= Math.min(a.row, b.row) && c.row <= Math.max(a.row, b.row)
    && c.column >= Math.min(a.column, b.column) && c.column <= Math.max(a.column, b.column);
}

/** Delegated selection: one state and event handler, no Vue instance/listener per cell. */
export function useCellSelection(host: SelectionHost) {
  const selection = shallowRef<ReportCellSelection | null>(null);
  function refresh(): void {
    const current = selection.value;
    const plan = host.plan.value;
    const modified = new Set(host.differences().map((edit) => JSON.stringify(edit.address)));
    host.root.value?.querySelectorAll<HTMLElement>("td[data-mr-row-index]").forEach((cell) => {
      const address = reportCellAddress(cell);
      if (!address) return;
      const selected = !!current && !!host.plan.value && inside(host.plan.value, address, current);
      cell.closest("table")?.setAttribute("role", "grid");
      const table = plan?.pages[address.pageIndex]?.components[address.componentIndex]?.table;
      cell.setAttribute("role", table?.role === "header" ? "columnheader" : "gridcell");
      cell.classList.toggle("mrp-cell-selected", selected);
      cell.classList.toggle("mrp-cell-focus", !!current && sameAddress(address, current.focus));
      cell.classList.toggle("mrp-cell-modified", modified.has(JSON.stringify(address)));
      cell.setAttribute("aria-selected", String(selected));
      cell.tabIndex = current && sameAddress(address, current.focus) ? 0 : -1;
    });
  }
  async function focusCell(address: ReportCellAddress, extend = false): Promise<boolean> {
    if (!host.plan.value || !getReportCellContext(host.plan.value, address)) return false;
    const old = selection.value;
    const canExtend = extend && old && selectionCoordinate(host.plan.value, old.anchor).grid === selectionCoordinate(host.plan.value, address, old.anchor).grid;
    selection.value = { anchor: canExtend ? old.anchor : { ...address }, focus: { ...address } };
    if (!host.root.value?.querySelector(selector(address))) host.gotoPage(address.pageIndex + 1);
    await nextTick();
    refresh();
    const cell = host.root.value?.querySelector<HTMLElement>(selector(address));
    cell?.focus({ preventScroll: true }); cell?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    return !!cell;
  }
  function onClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element) || target.closest("textarea,input,button,select")) return;
    const cell = target.closest<HTMLElement>("td[data-mr-row-index]");
    const address = cell && reportCellAddress(cell);
    if (!address || host.busy() || !host.plan.value || !getReportCellContext(host.plan.value, address)) return;
    const old = selection.value;
    const canExtend = event.shiftKey && old && selectionCoordinate(host.plan.value, old.anchor).grid === selectionCoordinate(host.plan.value, address, old.anchor).grid;
    selection.value = { anchor: canExtend ? old.anchor : { ...address }, focus: { ...address } };
    refresh();
    // Pointer cells are already mounted and visible. A deferred focus can blur the editor
    // opened by the following dblclick, causing an unchanged save to immediately close it.
    cell.focus({ preventScroll: true });
  }
  function addresses(address: ReportCellAddress): ReportCellAddress[] {
    const component = host.plan.value?.pages[address.pageIndex]?.components[address.componentIndex];
    if (!component?.grid) return [];
    return resolveGridLayout(component.grid, component.widthMm, component.heightMm).cells.map((box) => ({ ...address, rowIndex: box.ri, columnIndex: box.ci }));
  }
  function adjacent(address: ReportCellAddress, key: string, backwards: boolean): ReportCellAddress | undefined {
    const cells = addresses(address);
    const step = backwards ? -1 : 1;
    if (key === "Tab") return cells[cells.findIndex((cell) => sameAddress(cell, address)) + step];
    const vertical = key === "ArrowUp" || key === "ArrowDown" || key === "Enter";
    const direction = key === "ArrowUp" || key === "ArrowLeft" ? -1 : step;
    return cells.filter((cell) => vertical ? cell.columnIndex === address.columnIndex && (cell.rowIndex - address.rowIndex) * direction > 0 : cell.rowIndex === address.rowIndex && (cell.columnIndex - address.columnIndex) * direction > 0)
      .sort((a, b) => vertical ? (a.rowIndex - b.rowIndex) * direction : (a.columnIndex - b.columnIndex) * direction)[0];
  }
  function nextFragment(address: ReportCellAddress, key: string, backwards: boolean): ReportCellAddress | undefined {
    if (key === "ArrowLeft" || key === "ArrowRight") return undefined;
    const plan = host.plan.value!;
    const table = plan.pages[address.pageIndex]?.components[address.componentIndex]?.table;
    if (!table) return undefined;
    const direction = key === "ArrowUp" || backwards ? -1 : 1;
    for (let pageIndex = address.pageIndex; pageIndex >= 0 && pageIndex < plan.pages.length; pageIndex += direction) {
      const components = plan.pages[pageIndex]!.components;
      const start = pageIndex === address.pageIndex ? address.componentIndex + direction : direction === 1 ? 0 : components.length - 1;
      for (let componentIndex = start; componentIndex >= 0 && componentIndex < components.length; componentIndex += direction) {
        const candidate = fragmentTarget(address, { ...address, pageIndex, componentIndex }, key, direction);
        if (candidate) return candidate;
      }
    }
    return undefined;
  }
  function fragmentTarget(origin: ReportCellAddress, target: ReportCellAddress, key: string, direction: number): ReportCellAddress | undefined {
    const plan = host.plan.value!;
    const table = plan.pages[origin.pageIndex]!.components[origin.componentIndex]!.table!;
    const candidate = plan.pages[target.pageIndex]!.components[target.componentIndex]?.table;
    if (candidate?.id !== table.id) return undefined;
    // Printed headers repeat on every page; they are not new logical data rows.
    if (candidate.role === "header" && table.role !== "header" && (direction > 0 || table.rowIndex + origin.rowIndex > 0)) return undefined;
    const cells = addresses(target);
    const matches = key === "Tab" ? cells : cells.filter((cell) => cell.columnIndex === origin.columnIndex);
    return direction === 1 ? matches[0] : matches[matches.length - 1];
  }
  function navigate(address: ReportCellAddress, key: string, backwards = false, extend = false, nativeTab = false): boolean {
    const next = adjacent(address, key, backwards) ?? nextFragment(address, key, backwards);
    if (next) { void focusCell(next, extend); return true; }
    // Let native Tab leave the grid at its boundaries, including read-only previews.
    // Other movement keys retain the current focus instead of scrolling the host page.
    if (key !== "Tab" || !nativeTab) void focusCell(address);
    return false;
  }
  function onKeydown(event: KeyboardEvent): boolean {
    const current = selection.value;
    if (host.busy() || (event.target instanceof Element && event.target.closest("textarea,input,select"))) return false;
    if (!current) return beginNavigation(event);
    const key = event.key;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && key.toLowerCase() === "z") { event.preventDefault(); void (event.shiftKey ? host.redo() : host.undo()); return true; }
    if (modifier && key.toLowerCase() === "y") { event.preventDefault(); void host.redo(); return true; }
    if (beginEditing(event, current.focus)) return true;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Enter"].includes(key)) return false;
    const moved = navigate(current.focus, key, key === "Tab" && event.shiftKey, event.shiftKey && key !== "Tab", true);
    if (key === "Tab" && !moved) return false;
    event.preventDefault(); return true;
  }
  function beginEditing(event: KeyboardEvent, address: ReportCellAddress): boolean {
    if (!host.enabled() || !host.plan.value) return false;
    if (event.key !== "F2" && !(event.key === "Enter" && getReportCellContext(host.plan.value, address)?.editable)) return false;
    const cell = host.root.value?.querySelector<HTMLElement>(selector(address));
    if (cell) { event.preventDefault(); void host.edit(cell); }
    return true;
  }
  function beginNavigation(event: KeyboardEvent): boolean {
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Enter"].includes(event.key)) return false;
    const first = host.root.value?.querySelector<HTMLElement>("td[data-mr-row-index]");
    const address = first && reportCellAddress(first);
    if (!address) return false;
    event.preventDefault(); void focusCell(address); return true;
  }
  function copySelection(): string {
    const current = selection.value;
    const plan = host.plan.value;
    if (!current || !plan) return "";
    const rows: string[][] = [];
    const a = selectionCoordinate(plan, current.anchor);
    const b = selectionCoordinate(plan, current.focus, current.anchor);
    const resolve = selectionAddressResolver(plan, current.anchor);
    const cellAt = createReportCellResolver(plan);
    const minCol = Math.min(a.column, b.column);
    const maxCol = Math.max(a.column, b.column);
    if ((Math.abs(a.row - b.row) + 1) * (maxCol - minCol + 1) > 10_000) { host.error(new ReportCellEditError("limit")); return ""; }
    for (let rowIndex = Math.min(a.row, b.row); rowIndex <= Math.max(a.row, b.row); rowIndex++) {
      const row: string[] = [];
      for (let columnIndex = minCol; columnIndex <= maxCol; columnIndex++) {
        const address = resolve(rowIndex, columnIndex);
        row.push(address ? cellAt(address)?.cell.text ?? "" : "");
      }
      rows.push(row);
    }
    return formatReportClipboard(rows);
  }
  function onCopy(event: ClipboardEvent): void {
    if (!selection.value || (event.target instanceof Element && event.target.closest("textarea,input"))) return;
    event.clipboardData?.setData("text/plain", copySelection()); event.preventDefault();
  }
  async function pasteSelection(text: string): Promise<boolean> {
    const current = selection.value;
    if (!current || !host.enabled() || host.busy()) return false;
    try {
      let rows: string[][];
      try { rows = parseReportClipboard(text); }
      catch (cause) { throw new ReportCellEditError(cause instanceof Error && cause.message.includes("limit") ? "limit" : "clipboard"); }
      const plan = host.plan.value!;
      const a = selectionCoordinate(plan, current.anchor);
      const b = selectionCoordinate(plan, current.focus, current.anchor);
      const resolve = selectionAddressResolver(plan, current.anchor);
      const inputs = rows.flatMap((row, rowOffset) => row.map((value, columnOffset) => {
        const address = resolve(Math.min(a.row, b.row) + rowOffset, Math.min(a.column, b.column) + columnOffset);
        if (!address) throw new ReportCellEditError("missing");
        return { address, value };
      }));
      return await host.apply(inputs);
    } catch (cause) { host.error(cause); return false; }
  }
  function onPaste(event: ClipboardEvent): void {
    if (!selection.value || !host.enabled() || (event.target instanceof Element && event.target.closest("textarea,input"))) return;
    const text = event.clipboardData?.getData("text/plain");
    if (text !== undefined) { event.preventDefault(); void pasteSelection(text); }
  }
  async function focusField(target: ReportFieldTarget): Promise<boolean> {
    const plan = host.plan.value;
    if (!plan) return false;
    const cellAt = createReportCellResolver(plan);
    for (let pageIndex = 0; pageIndex < plan.pages.length; pageIndex++) {
      const page = plan.pages[pageIndex]!;
      for (let componentIndex = 0; componentIndex < page.components.length; componentIndex++) {
        for (const address of addresses({ pageIndex, componentIndex, rowIndex: 0, columnIndex: 0 })) {
          const context = cellAt(address);
          const source = context?.source;
          if ((source?.field ?? context?.table?.columnKey) !== target.field) continue;
          if (target.datasetId !== undefined && source?.datasetId !== target.datasetId) continue;
          if (target.rowKey !== undefined && source?.rowKey !== target.rowKey) continue;
          return focusCell(address);
        }
      }
    }
    return false;
  }
  function reset(): void { selection.value = null; refresh(); }
  return { selection, refresh, reset, focusCell, focusField, navigate, onClick, onKeydown, onCopy, onPaste, copySelection, pasteSelection };
}
