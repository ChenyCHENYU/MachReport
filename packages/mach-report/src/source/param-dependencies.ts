import type { ReportParamDef } from "../layout/paginate";

export function remoteParamMetadataIssues(def: ReportParamDef): string[] {
  const issues: string[] = [];
  if (def.optionsSource !== undefined) {
    if (def.type !== "select" || typeof def.optionsSource !== "string" || !/^[\w][\w.:-]{0,127}$/.test(def.optionsSource)) issues.push("远程选项来源应为 select 的有效来源键（最多 128 字符）");
    if (def.options !== undefined) issues.push("远程选项来源与静态选项不能同时配置");
  }
  if (def.dependsOn !== undefined && (!def.optionsSource || !Array.isArray(def.dependsOn) || def.dependsOn.length > 32 || def.dependsOn.some(field => typeof field !== "string" || !field) || new Set(def.dependsOn).size !== def.dependsOn.length)) issues.push("联动依赖应为远程选项的最多 32 个唯一参数名");
  return issues;
}

/** Linear graph validation also rejects cycles without recursive traversal. */
export function paramDependencyIssues(defs: readonly ReportParamDef[]): { index: number; message: string }[] {
  const nodes = new Map(defs.map((def, index) => [def.field, { def, index, degree: 0, children: [] as string[] }]));
  const issues: { index: number; message: string }[] = [];
  for (const node of nodes.values()) for (const field of node.def.dependsOn ?? []) {
    const parent = nodes.get(field);
    if (!parent) { issues.push({ index: node.index, message: `联动依赖参数 ${field} 未声明` }); continue; }
    node.degree++; parent.children.push(node.def.field);
  }
  const queue = [...nodes.values()].filter(node => node.degree === 0);
  for (let cursor = 0; cursor < queue.length; cursor++) for (const field of queue[cursor]!.children) {
    const child = nodes.get(field)!;
    if (--child.degree === 0) queue.push(child);
  }
  for (const node of nodes.values()) if (node.degree > 0) issues.push({ index: node.index, message: "联动依赖不能形成循环" });
  return issues;
}
