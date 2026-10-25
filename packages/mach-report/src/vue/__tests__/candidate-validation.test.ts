import { describe, expect, it, vi } from "vitest";
import { ref, shallowRef } from "vue";
import { mount } from "@vue/test-utils";
import { createTableTemplate } from "../../builder/table-template";
import { createReportEditSession } from "../../editing/session";
import { paginateTemplate } from "../../layout/paginate";
import { getReportCellContext } from "../../editing/context";
import type { ReportValidationRule } from "../../editing/validation";
import type { ReportEditingOptions } from "../editing";
import { useEditHistory } from "../composables/useEditHistory";
import ReportValidationPanel from "../ReportValidationPanel.vue";
const rules: ReportValidationRule[] = [{ id: "bounds", assert: { field: "output", op: "<=", right: { field: "input" }, valueType: "number" }, field: "output", message: "出钢重超出投料重" }];
function fixture(source = true, nestedInvalid = false) {
  const template = createTableTemplate({ layout: "wide", columns: [{ field: "id", header: "ID" }, { field: "input", header: "入", valueType: "number" }, { field: "output", header: "出", valueType: "number" }, { field: "loss", header: "损耗" }], listOptions: { rowKey: "id", computed: source ? [{ field: "loss", expression: { op: "subtract", args: [{ field: "input" }, { field: "output" }] } }] : undefined } });
  if (nestedInvalid) template.pages[0]!.components.push({ kind: "list", dataset: "tree", leftMm: 0, topMm: 100, widthMm: 100, tree: { input: "nested", idField: "id", labelField: "name" }, columns: [{ field: "name", header: "名称", widthMm: 50 }, { field: "value", header: "数值", widthMm: 50 }] });
  const datasets = { ...(nestedInvalid ? { tree: [{ id: "root", name: "根", value: 3, children: [{ id: "child", name: "子", value: -1 }] }] } : {}), detail: [{ id: "a", input: 2, output: 1 }, { id: "b", input: 3, output: 2 }] };
  const session = source ? createReportEditSession({ template, datasets }) : undefined;
  const plan = shallowRef(session?.plan ?? paginateTemplate(template, datasets).plan);
  const saveBatch = vi.fn(); const onError = vi.fn();
  const options = ref<ReportEditingOptions>({ validation: { rules }, saveBatch });
  const history = useEditHistory({ plan, options, blocked: () => false, onError, onChange: vi.fn() });
  function cell(field: string, value: number, key = "a") {
    for (const [pageIndex, page] of plan.value.pages.entries()) for (const [componentIndex, component] of page.components.entries()) if (component.table?.role === "body" && component.table.source?.rowKey === key) return { address: getReportCellContext(plan.value, { pageIndex, componentIndex, rowIndex: 0, columnIndex: component.table.columnKeys.indexOf(field) })!.address, value };
    throw new Error("missing");
  }
  return { plan, saveBatch, onError, options, history, cell };
}
describe("candidate validation transaction integration", () => {
  it("collects all problems and never calls persistence or mutates the baseline on error", async () => {
    const f = fixture(), baseline = f.plan.value;
    expect(await f.history.apply([f.cell("output", 5), f.cell("output", 6, "b")])).toBe(false);
    expect(f.history.validationIssues.value).toHaveLength(2);
    expect(f.saveBatch).not.toHaveBeenCalled(); expect(f.plan.value).toBe(baseline);
    expect(f.history.canUndo.value).toBe(false);
    expect(await f.history.apply([f.cell("input", 6), f.cell("output", 5)])).toBe(true);
    expect(f.history.validationIssues.value).toEqual([]); expect(f.saveBatch).toHaveBeenCalledTimes(1);
    expect(await f.history.undo()).toBe(true); expect(await f.history.redo()).toBe(true);
  });
  it("keeps warnings visible, allows them by default and blocks only with explicit policy", async () => {
    const f = fixture(); f.options.value.validation = { rules: rules.map(rule => ({ ...rule, severity: "warning" })) };
    expect(await f.history.apply([f.cell("output", 5)])).toBe(true);
    expect(f.history.validationIssues.value).toMatchObject([{ severity: "warning", rowKey: "a" }]);
    f.options.value.validation.warningPolicy = "block";
    const baseline = f.plan.value;
    expect(await f.history.apply([f.cell("output", 6)])).toBe(false);
    expect(f.plan.value).toBe(baseline); expect(f.saveBatch).toHaveBeenCalledTimes(1);
  });
  it("exposes the fully recalculated candidate to host batch validation before saving", async () => {
    const f = fixture();
    f.options.value.validateBatch = (_batch, candidate) => {
      const values = candidate.pages.flatMap(page => page.components.flatMap(component => component.grid?.cells.flatMap(row => row.map(cell => cell?.value)) ?? []));
      expect(values).toContain(4);
      return [{ ruleId: "host", severity: "error", message: "业务拒绝" }];
    };
    expect(await f.history.apply([f.cell("input", 5)])).toBe(false); expect(f.saveBatch).not.toHaveBeenCalled();
    expect(f.history.validationIssues.value).toMatchObject([{ ruleId: "host" }]);
  });
  it("fails closed for raw plans when complete source candidate validation cannot be reconstructed", async () => {
    const f = fixture(false);
    expect(await f.history.apply([f.cell("input", 5)])).toBe(false);
    expect(f.history.lastError.value).toContain("来源数据会话"); expect(f.saveBatch).not.toHaveBeenCalled();
    delete f.options.value.validation;
    f.options.value.validateBatch = () => [{ ruleId: "raw", severity: "error", message: "原始计划也不能漏验" }];
    expect(await f.history.apply([f.cell("input", 5)])).toBe(false); expect(f.history.validationIssues.value).toHaveLength(1);
  });
  it("surfaces malformed rule failures instead of publishing empty success, and resets issues on reload", async () => {
    const f = fixture(); f.options.value.validation!.rules = [{ ...rules[0]!, assert: { all: [] } }];
    expect(await f.history.apply([f.cell("input", 5)])).toBe(false); expect(f.history.lastError.value).toContain("组合条件");
    expect(f.saveBatch).not.toHaveBeenCalled(); f.history.reset(); expect(f.history.validationIssues.value).toEqual([]);
  });
  it("blocks saveBatch when a nested child is invalid although the visible root and edited dataset are valid", async () => {
    const f = fixture(true, true), baseline = f.plan.value;
    f.options.value.validation = { rules: [{ id: "tree-value", dataset: "tree", field: "value", assert: { field: "value", op: ">=", value: 0 }, message: "子节点不合法" }] };
    expect(await f.history.apply([f.cell("input", 5)])).toBe(false);
    expect(f.saveBatch).not.toHaveBeenCalled(); expect(f.plan.value).toBe(baseline);
    expect(f.history.validationIssues.value).toMatchObject([{ rowKey: "child", field: "value", dataset: "tree" }]);
  });
  it("renders compact severity counts with keyboard-accessible stable issue navigation", () => {
    const issues = [{ ruleId: "x", severity: "error" as const, message: "超限", rowKey: 0, field: "amount", dataset: "detail" }, { ruleId: "y", severity: "warning" as const, message: "请核实" }];
    const wrapper = mount(ReportValidationPanel, { props: { issues } });
    expect(wrapper.text()).toContain("1 错误 · 1 提示"); expect(wrapper.text()).toContain("detail · 0 · amount");
    wrapper.get("button").trigger("click"); expect(wrapper.emitted("locate")?.[0]).toEqual([issues[0]]);
    wrapper.unmount();
  });
});
