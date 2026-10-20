export const TEMPLATE_REVIEW_MESSAGES = {
  stale: "输入或验收范围已变化，旧结果已失效，请重新运行检查。", scope: "上次实测范围", datasets: "个数据集",
  treeHint: "树形数据保留完整父子关系；20/100 作为本次总节点预算，超出请选全部或提供完整小样例。",
  title: "变更与验收", run: "运行检查", running: "检查中…", samples: "验收样例", none: "仅检查结构", first20: "每个数据集前 20 行", first100: "每个数据集前 100 行", all: "全部当前数据（总计 ≤1000 行）",
  changes: "模板变更", issues: "待处理项", results: "样例结果", noChanges: "与基线一致", noIssues: "本次检查未发现问题", empty: "选择验收样例后运行，检查字段映射、排版与输出能力。", baseline: "未提供上一版本，仅检查当前模板。",
  errors: "错误", warnings: "提示", locate: "定位", before: "修改前", after: "修改后", breaking: "影响兼容性", acknowledge: "已确认字段与结构变更", truncated: "变更较多，仅展示前 500 项；兼容检查仍包含全部变更。", pages: "页", rows: "行", checked: "检查结果对应本次样例，不代替服务端发布权限与全量数据校验。",
  categories: { metadata: "信息", structure: "结构", binding: "字段", calculation: "计算", format: "样式" },
  kinds: { added: "新增", removed: "删除", modified: "修改", moved: "调序" }
};
export type TemplateReviewMessages = typeof TEMPLATE_REVIEW_MESSAGES;
