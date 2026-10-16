// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import { renderPage, type PlanComponent, type RenderPlan, type ReportCellAddress, type ReportCellEdit } from "../../index";
import { useCellSelection } from "../composables/useCellSelection";

function component(role: "header" | "body", rowIndex: number, columnKeys: string[], values: string[]): PlanComponent {
  return { kind: "rect", leftMm: 0, topMm: role === "header" ? 0 : 15 + rowIndex * 10, widthMm: 80, heightMm: role === "header" ? 12 : 10,
    table: { id: "orders", role, rowIndex, columnKeys },
    grid: { colWidthsMm: [40, 40], cells: role === "header" ? [[{ text: "Merged", colSpan: 2 }], values.map((text) => ({ text }))] : [values.map((text) => ({ text }))] }
  };
}
function sourcePlan(): RenderPlan {
  return { schemaVersion: "refresh", pages: [
    { pageWidthMm: 100, pageHeightMm: 100, components: [component("header", -1, ["code", "qty"], ["Code", "Quantity"]), component("body", 0, ["code", "qty"], ["001", "0"]), component("body", 1, ["qty", "code"], ["2", "002"])] },
    { pageWidthMm: 100, pageHeightMm: 100, components: [component("header", -1, ["qty", "code"], ["Quantity", "Code"]), component("body", 2, ["qty", "code"], ["3", "003"])] }
  ] };
}
function fixture(initialPages = 2) {
  const original = sourcePlan(); const plan = shallowRef<RenderPlan | null>(original); const differences = shallowRef<ReportCellEdit[]>([]);
  const root = document.createElement("div"); document.body.append(root);
  function appendPage(index: number) {
    const holder = document.createElement("div"); holder.className = "mrp-page-holder"; holder.dataset.page = String(index + 1);
    holder.append(renderPage(original.pages[index]!, 96, {}, document)); root.append(holder); return holder;
  }
  for (let index = 0; index < initialPages; index++) appendPage(index);
  const selection = useCellSelection({ plan, root: shallowRef(root), differences: () => differences.value, enabled: () => true, busy: () => false, gotoPage: vi.fn(), edit: vi.fn(), apply: vi.fn(), undo: vi.fn(), redo: vi.fn(), error: vi.fn() });
  return { original, plan, differences, root, selection, appendPage };
}
function cell(root: HTMLElement, address: ReportCellAddress): HTMLElement {
  return root.querySelector(`[data-page="${address.pageIndex + 1}"] [data-mr-component-index="${address.componentIndex}"] td[data-mr-row-index="${address.rowIndex}"][data-mr-column-index="${address.columnIndex}"]`)!;
}
const address = (pageIndex: number, componentIndex: number, columnIndex = 0): ReportCellAddress => ({ pageIndex, componentIndex, rowIndex: 0, columnIndex });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("selection refresh initializes semantics once and paints only changed state", () => {
  it("preserves grid/header accessibility without selection and performs zero repeated attribute mutations", () => {
    const { root, selection } = fixture(); const observer = new MutationObserver(() => {}); observer.observe(root, { attributes: true, subtree: true });
    selection.refresh();
    expect(root.querySelectorAll('table[role="grid"]')).toHaveLength(5);
    expect(root.querySelectorAll('[role="columnheader"]')).toHaveLength(6);
    expect(root.querySelectorAll('[role="gridcell"]')).toHaveLength(6);
    expect(root.querySelectorAll('td[aria-selected="false"][tabindex="-1"]')).toHaveLength(12);
    expect(observer.takeRecords().filter((record) => record.target instanceof HTMLTableElement && record.attributeName === "role")).toHaveLength(5);
    selection.refresh(); selection.refresh(); expect(observer.takeRecords()).toEqual([]); observer.disconnect();
  });
  it("initializes a newly mounted page in isolation, including a pre-existing modification", () => {
    const { root, selection, appendPage, differences } = fixture(1); selection.refresh();
    const target = address(1, 1, 1);
    differences.value = [{ address: target, previousValue: "old", previousText: "old", value: "003", text: "003" }];
    const holder = appendPage(1); const observer = new MutationObserver(() => {}); observer.observe(root, { attributes: true, subtree: true });
    selection.refresh(holder);
    const mutations = observer.takeRecords(); expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.every((record) => holder.contains(record.target))).toBe(true);
    expect(holder.querySelectorAll('table[role="grid"]')).toHaveLength(2);
    expect(holder.querySelectorAll('[role="columnheader"]')).toHaveLength(3);
    expect(cell(root, target).classList.contains("mrp-cell-modified")).toBe(true);
    selection.refresh(holder); expect(observer.takeRecords()).toEqual([]); observer.disconnect();
  });
  it("maps cross-page selections by logical column identity while excluding repeated multirow headers", async () => {
    const { root, selection } = fixture(); selection.refresh();
    await selection.focusCell(address(0, 1, 0)); await selection.focusCell(address(1, 1, 1), true);
    expect(Array.from(root.querySelectorAll(".mrp-cell-selected"), (element) => element.textContent)).toEqual(["001", "002", "003"]);
    expect(root.querySelectorAll('td[aria-selected="true"]')).toHaveLength(3);
    expect(cell(root, address(1, 1, 1)).getAttribute("tabindex")).toBe("0");
    expect(root.querySelectorAll('[role="columnheader"].mrp-cell-selected')).toHaveLength(0);
    expect(selection.copySelection()).toBe("001\r\n002\r\n003");
    const observer = new MutationObserver(() => {}); observer.observe(root, { attributes: true, subtree: true });
    selection.refresh(); expect(observer.takeRecords()).toEqual([]);
    selection.reset(); expect(root.querySelectorAll(".mrp-cell-selected,.mrp-cell-focus")).toHaveLength(0);
    expect(root.querySelectorAll('[role="columnheader"]')).toHaveLength(6);
    selection.refresh(); observer.takeRecords(); selection.refresh(); expect(observer.takeRecords()).toEqual([]); observer.disconnect();
  });
  it("initializes replacement cells in an existing table and responds to changed plan roles", () => {
    const { root, selection, plan, original } = fixture(); selection.refresh();
    const body = root.querySelector<HTMLTableElement>('[data-page="1"] [data-mr-component-index="1"] table')!;
    const replacement = document.createElement("td"); replacement.dataset.mrRowIndex = "0"; replacement.dataset.mrColumnIndex = "0"; replacement.textContent = "replacement";
    body.rows[0]!.replaceChild(replacement, body.rows[0]!.cells[0]!); selection.refresh(body);
    expect(replacement.getAttribute("role")).toBe("gridcell"); expect(replacement.getAttribute("aria-selected")).toBe("false"); expect(replacement.getAttribute("tabindex")).toBe("-1");
    const next = structuredClone(original); next.pages[0]!.components[1]!.table!.role = "header"; plan.value = next; selection.refresh(body);
    expect(replacement.getAttribute("role")).toBe("columnheader");
    const observer = new MutationObserver(() => {}); observer.observe(body, { attributes: true, subtree: true }); selection.refresh(body); expect(observer.takeRecords()).toEqual([]); observer.disconnect();
  });
});
