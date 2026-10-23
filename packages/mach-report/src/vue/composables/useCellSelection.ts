import { nextTick, shallowRef, watch, type Ref } from "vue";
import { createReportCellResolver, formatReportClipboard, getReportCellContext, parseReportClipboard, ReportCellEditError, type PlanComponent, type RenderPlan, type ReportCellAddress, type ReportCellContext, type ReportCellEdit, type ReportCellInput } from "@agile-team/mach-report";
import { resolveGridLayout } from "../../render/grid-geometry";
import { reportCellAddress } from "./useCellEditing";
import { selectionAddressResolver, selectionCoordinate } from "./selection-grid";
import { focusAdjacentControl } from "./focus-order";
import { createEditAddressResolver } from "./edit-recalculation";

export interface ReportCellSelection { anchor: ReportCellAddress; focus: ReportCellAddress }
export interface ReportFieldTarget { field: string; datasetId?: string; rowKey?: string | number; tableId?: string; reportScope?: string }
function matchesField(context: ReportCellContext | null | undefined, target: ReportFieldTarget): boolean {
  const source = context?.source;
  if (!containsField(context, target.field)) return false;
  if (target.tableId !== undefined && context?.table?.id !== target.tableId) return false;
  if (target.datasetId !== undefined && (source?.datasetId ?? context?.component.table?.source?.datasetId) !== target.datasetId) return false;
  return target.rowKey === undefined || source?.rowKey === target.rowKey;
}
function containsField(context: ReportCellContext | null | undefined, field: string): boolean {
  if ((context?.source?.field ?? context?.table?.columnKey) === field) return true;
  if (!context || context.table?.role !== "header") return false;
  const start = context.address.columnIndex;
  return context.component.table?.columnKeys.slice(start, start + (context.cell.colSpan ?? 1)).includes(field) ?? false;
}
interface SelectionHost {
  plan: Ref<RenderPlan | null>;
  root: Ref<HTMLElement | null>;
  enabled(): boolean;
  /** 选区分析可独立于编辑启用；省略时保持已有 enabled 的编辑语义。 */
  editable?(): boolean;
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
interface SelectionBounds { grid: string; minRow: number; maxRow: number; minColumn: number; maxColumn: number; focusKey: string; origin?: PlanComponent["table"] }
interface TableAddress { pageIndex: number; componentIndex: number }
interface TableCoordinates { grid: string; rowOffset: number; columns?: readonly number[]; missingColumn: number }
interface CellPaint { row: number; column: number; key: string; role?: string; selected?: boolean; focused?: boolean; modified?: boolean }
function addressKey(address: ReportCellAddress): string {
  return `${address.pageIndex}:${address.componentIndex}:${address.rowIndex}:${address.columnIndex}`;
}
function selectionBounds(plan: RenderPlan, selection: ReportCellSelection): SelectionBounds {
  const a = selectionCoordinate(plan, selection.anchor);
  const b = selectionCoordinate(plan, selection.focus, selection.anchor);
  return { grid: a.grid, minRow: Math.min(a.row, b.row), maxRow: Math.max(a.row, b.row), minColumn: Math.min(a.column, b.column), maxColumn: Math.max(a.column, b.column), focusKey: addressKey(selection.focus), origin: plan.pages[selection.anchor.pageIndex]?.components[selection.anchor.componentIndex]?.table };
}
function tableCoordinates(base: TableAddress, component: PlanComponent | undefined, bounds: SelectionBounds): TableCoordinates {
  const table = component?.table;
  if (!table || !bounds.origin || table.id !== bounds.origin.id) return { grid: `${base.pageIndex}:${base.componentIndex}`, rowOffset: 0, missingColumn: -1 };
  const indices = new Map<string, number>();
  bounds.origin.columnKeys.forEach((key, index) => { if (!indices.has(key)) indices.set(key, index); });
  return { grid: table.id, rowOffset: table.role === "header" ? -Math.max(1, component.grid?.cells.length ?? 1) : table.rowIndex, columns: table.columnKeys.map((key) => indices.get(key) ?? -1), missingColumn: indices.get("") ?? -1 };
}
function insideBounds(cell: CellPaint, coordinates: TableCoordinates | null, bounds: SelectionBounds | null): boolean {
  if (!bounds || !coordinates || coordinates.grid !== bounds.grid) return false;
  const row = coordinates.rowOffset + cell.row;
  const column = coordinates.columns ? coordinates.columns[cell.column] ?? coordinates.missingColumn : cell.column;
  return row >= bounds.minRow && row <= bounds.maxRow && column >= bounds.minColumn && column <= bounds.maxColumn;
}
function setAttributeIfChanged(element: HTMLElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
function setClassIfChanged(cell: HTMLElement, name: string, value: boolean): void {
  if (cell.classList.contains(name) !== value) cell.classList.toggle(name, value);
}
function paintCell(cell: HTMLElement, state: CellPaint, role: string, selected: boolean, focused: boolean, modified: boolean): void {
  if (state.role !== role) { setAttributeIfChanged(cell, "role", role); state.role = role; }
  if (state.selected !== selected) {
    setClassIfChanged(cell, "mrp-cell-selected", selected);
    setAttributeIfChanged(cell, "aria-selected", String(selected)); state.selected = selected;
  }
  if (state.focused !== focused) {
    setClassIfChanged(cell, "mrp-cell-focus", focused);
    setAttributeIfChanged(cell, "tabindex", focused ? "0" : "-1"); state.focused = focused;
  }
  if (state.modified !== modified) { setClassIfChanged(cell, "mrp-cell-modified", modified); state.modified = modified; }
}

/** Delegated selection: one state and event handler, no Vue instance/listener per cell. */
export function useCellSelection(host: SelectionHost) {
  const canEdit = () => host.editable?.() ?? host.enabled();
  const selection = shallowRef<ReportCellSelection | null>(null);
  const tableAddresses = new WeakMap<HTMLTableElement, TableAddress>();
  const cellPaints = new WeakMap<HTMLTableCellElement, CellPaint>();
  let previousDifferences: readonly ReportCellEdit[] | null = null;
  let previousPlan: RenderPlan | null = null;
  let modifiedKeys = new Set<string>();
  function selectionEdit(plan: RenderPlan, address: ReportCellAddress): ReportCellEdit | null {
    const context = getReportCellContext(plan, address);
    if (!context || plan.requiresRecalculation && !context.source) return null;
    return { address: context.address, source: context.source, table: context.table, value: context.value, previousValue: context.value, text: context.cell.text ?? "", previousText: context.cell.text ?? "" };
  }
  watch(host.plan, (next, previous) => {
    const current = selection.value;
    if (!current) return;
    if (!next || !previous) { selection.value = null; return; }
    const anchorEdit = selectionEdit(previous, current.anchor), focusEdit = selectionEdit(previous, current.focus);
    const resolve = createEditAddressResolver(next);
    const anchor = anchorEdit && resolve(anchorEdit), focus = focusEdit && resolve(focusEdit);
    selection.value = anchor && focus ? { anchor, focus } : null;
  }, { flush: "sync" });
  function refresh(scope = host.root.value ?? undefined): void {
    if (!scope) return;
    const current = selection.value;
    const plan = host.plan.value;
    const differences = host.differences();
    if (differences !== previousDifferences || plan !== previousPlan) {
      previousDifferences = differences; previousPlan = plan;
      const locate = plan && differences.length ? createEditAddressResolver(plan) : null;
      modifiedKeys = new Set(differences.flatMap((edit) => locate ? locate.all(edit).map(addressKey) : []));
    }
    const bounds = current && plan ? selectionBounds(plan, current) : null;
    if (scope instanceof HTMLTableElement) refreshTable(scope, plan, bounds);
    for (const table of scope.querySelectorAll<HTMLTableElement>("table")) refreshTable(table, plan, bounds);
  }
  function tableAddress(table: HTMLTableElement): TableAddress | null {
    const existing = tableAddresses.get(table);
    if (existing) return existing;
    const component = table.closest<HTMLElement>("[data-mr-component-index]");
    const holder = component?.closest<HTMLElement>(".mrp-page-holder");
    const address = { pageIndex: Number(holder?.dataset.page) - 1, componentIndex: Number(component?.dataset.mrComponentIndex) };
    if (!Object.values(address).every((value) => Number.isInteger(value) && value >= 0)) return null;
    tableAddresses.set(table, address); return address;
  }
  function cellPaint(cell: HTMLTableCellElement, base: TableAddress): CellPaint | null {
    const existing = cellPaints.get(cell);
    if (existing) return existing;
    const rowIndex = Number(cell.dataset.mrRowIndex), columnIndex = Number(cell.dataset.mrColumnIndex);
    if (![rowIndex, columnIndex].every((value) => Number.isInteger(value) && value >= 0)) return null;
    const state = { row: rowIndex, column: columnIndex, key: addressKey({ ...base, rowIndex, columnIndex }) };
    cellPaints.set(cell, state); return state;
  }
  function refreshTable(table: HTMLTableElement, plan: RenderPlan | null, bounds: SelectionBounds | null): void {
    const base = tableAddress(table);
    if (!base) return;
    const component = plan?.pages[base.pageIndex]?.components[base.componentIndex];
    const role = component?.table?.role === "header" ? "columnheader" : "gridcell";
    const coordinates = bounds ? tableCoordinates(base, component, bounds) : null;
    setAttributeIfChanged(table, "role", "grid");
    for (const row of table.rows) for (const cell of row.cells) {
      const state = cellPaint(cell, base);
      if (!state) continue;
      paintCell(cell, state, role, insideBounds(state, coordinates, bounds), bounds?.focusKey === state.key, modifiedKeys.size > 0 && modifiedKeys.has(state.key));
    }
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
    if (host.busy() || (event.target instanceof Element && event.target.closest("textarea,input,select,button,a[href],[contenteditable]"))) return false;
    if (!current) return beginNavigation(event);
    const key = event.key;
    if (historyShortcut(event)) return true;
    if (beginEditing(event, current.focus)) return true;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Enter"].includes(key)) return false;
    const moved = navigate(current.focus, key, key === "Tab" && event.shiftKey, event.shiftKey && key !== "Tab", true);
    if (key === "Tab" && !moved) {
      const active = host.root.value?.ownerDocument.activeElement;
      if (!(active instanceof HTMLElement) || !focusAdjacentControl(active, event.shiftKey)) return false;
    }
    event.preventDefault(); return true;
  }
  /** 只把编辑授权下的历史快捷键交给事务层；只读选区不拦截宿主快捷键。 */
  function historyShortcut(event: KeyboardEvent): boolean {
    if (!canEdit() || !(event.ctrlKey || event.metaKey)) return false;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return false;
    event.preventDefault();
    void (key === "y" || event.shiftKey ? host.redo() : host.undo());
    return true;
  }
  function beginEditing(event: KeyboardEvent, address: ReportCellAddress): boolean {
    if (!canEdit() || !host.plan.value) return false;
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
    if (!selection.value || (event.target instanceof Element && event.target.closest("textarea,input,select"))) return;
    event.clipboardData?.setData("text/plain", copySelection()); event.preventDefault();
  }
  async function pasteSelection(text: string): Promise<boolean> {
    const current = selection.value;
    if (!current || !canEdit() || host.busy()) return false;
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
    if (!selection.value || !canEdit() || (event.target instanceof Element && event.target.closest("textarea,input,select,button,a[href],[contenteditable]"))) return;
    if (!event.clipboardData?.types.includes("text/plain")) return;
    const text = event.clipboardData?.getData("text/plain");
    if (text) { event.preventDefault(); void pasteSelection(text); }
  }
  async function focusField(target: ReportFieldTarget): Promise<boolean> {
    const plan = host.plan.value;
    if (!plan) return false;
    const cellAt = createReportCellResolver(plan);
    for (let pageIndex = 0; pageIndex < plan.pages.length; pageIndex++) {
      const page = plan.pages[pageIndex]!;
      if (target.reportScope !== undefined && page.meta?.reportScope !== target.reportScope) continue;
      for (let componentIndex = 0; componentIndex < page.components.length; componentIndex++) {
        for (const address of addresses({ pageIndex, componentIndex, rowIndex: 0, columnIndex: 0 })) {
          const context = cellAt(address);
          if (!matchesField(context, target)) continue;
          return focusCell(address);
        }
      }
    }
    return false;
  }
  function reset(): void { selection.value = null; refresh(); }
  return { selection, refresh, reset, focusCell, focusField, navigate, onClick, onKeydown, onCopy, onPaste, copySelection, pasteSelection };
}
