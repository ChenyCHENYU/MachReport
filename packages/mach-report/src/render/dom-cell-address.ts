/** Element-owned metadata crosses split core/Vue bundles without retaining a global node cache. */
const ADDRESS = Symbol.for("@agile-team/mach-report/dom-cell-address");
export interface DomCellAddress { rowIndex: number; columnIndex: number }
type AddressedElement = HTMLElement & { [ADDRESS]?: DomCellAddress };
export function setDomCellAddress(cell: HTMLElement, rowIndex: number, columnIndex: number): void {
  cell.dataset.mrRowIndex = String(rowIndex); cell.dataset.mrColumnIndex = String(columnIndex);
  (cell as AddressedElement)[ADDRESS] = { rowIndex, columnIndex };
}
export function getDomCellAddress(cell: HTMLElement): DomCellAddress | undefined { return (cell as AddressedElement)[ADDRESS]; }
