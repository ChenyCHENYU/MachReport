interface TreeIssue { path: string; message: string }
interface Budget { nodes: number }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object"; }
function visit(value: unknown, path: string, depth: number, ancestors: Set<object>, budget: Budget): TreeIssue | undefined {
  if (++budget.nodes > 1_000_000) return { path, message: "组件树超过100万个结构节点预算" };
  if (!object(value)) return;
  if (depth > 64) return { path, message: "组件嵌套超过64层预算" };
  if (ancestors.has(value)) return { path, message: "组件树包含循环引用" };
  if (!object(value.grid) || !Array.isArray(value.grid.cells)) return;
  ancestors.add(value);
  try {
    for (const [ri, row] of value.grid.cells.entries()) {
      if (!Array.isArray(row)) continue;
      for (const [ci, cell] of row.entries()) {
        if (++budget.nodes > 1_000_000) return { path, message: "组件树超过100万个结构节点预算" };
        if (!object(cell) || !Array.isArray(cell.children)) continue;
        for (const [ki, child] of cell.children.entries()) {
          const issue = visit(child, `${path}.grid.cells.${ri}.${ci}.children.${ki}`, depth + 1, ancestors, budget);
          if (issue) return issue;
        }
      }
    }
  } finally { ancestors.delete(value); }
}
export function componentTreeIssue(components: unknown[], path = "$.components", budget: Budget = { nodes: 0 }): TreeIssue | undefined {
  for (const [index, component] of components.entries()) {
    const issue = visit(component, `${path}.${index}`, 0, new Set(), budget);
    if (issue) return issue;
  }
}
export function renderTreeIssue(pages: unknown[]): TreeIssue | undefined {
  const budget = { nodes: 0 };
  for (const [index, page] of pages.entries()) {
    if (!object(page) || !Array.isArray(page.components)) continue;
    const issue = componentTreeIssue(page.components, `$.pages.${index}.components`, budget);
    if (issue) return issue;
  }
}
export function assertBoundedRenderTree(plan: { pages: unknown[] }): void {
  const issue = renderTreeIssue(plan.pages);
  if (issue) throw new TypeError(`${issue.path}: ${issue.message}`);
}
