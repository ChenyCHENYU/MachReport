export interface ConflictReviewMessages {
  conflictReviewTitle: string;
  conflictReviewDescription: string;
  conflictReviewRefresh: string;
  conflictReviewLoading: string;
  conflictReviewApply: string;
  conflictReviewOriginal: string;
  conflictReviewLocal: string;
  conflictReviewServer: string;
  conflictReviewChoose: string;
  conflictReviewMissing: string;
  conflictReviewAmbiguous: string;
  conflictReviewReadonly: string;
  conflictReviewUnavailable: string;
  conflictReviewCount: string;
  conflictReviewSearch: string;
  conflictReviewEmpty: string;
  conflictReviewStale: string;
  conflictReviewRetained: string;
}
export const DEFAULT_CONFLICT_MESSAGES: ConflictReviewMessages = {
  conflictReviewTitle: "核对保存冲突",
  conflictReviewDescription: "已保留本地修改。对照最新查询，选择需保留的值，再统一校验并提交。",
  conflictReviewRefresh: "读取最新数据", conflictReviewLoading: "正在读取最新数据…", conflictReviewApply: "校验并提交选择",
  conflictReviewOriginal: "修改前", conflictReviewLocal: "保留我的修改", conflictReviewServer: "使用最新数据", conflictReviewChoose: "请选择要保留的值",
  conflictReviewMissing: "该业务字段已不在最新结果中", conflictReviewAmbiguous: "同一业务字段的多个显示值不一致", conflictReviewReadonly: "该字段现已只读",
  conflictReviewUnavailable: "当前预览缺少可重新查询的来源，请由宿主核对后重新加载。",
  conflictReviewCount: "共 {count} 项 · 待选择 {pending} 项", conflictReviewSearch: "搜索字段、数据集或业务键", conflictReviewEmpty: "没有匹配的待核对项",
  conflictReviewStale: "当前查询已变化，请重新读取最新数据后核对。", conflictReviewRetained: "修改仍已保留，可重新读取核对或关闭后继续编辑。"
};
export function resolveConflictMessages(overrides: Partial<ConflictReviewMessages>): ConflictReviewMessages {
  const result = { ...DEFAULT_CONFLICT_MESSAGES };
  for (const key of Object.keys(result) as (keyof ConflictReviewMessages)[]) if (typeof overrides[key] === "string") result[key] = overrides[key]!;
  return result;
}
