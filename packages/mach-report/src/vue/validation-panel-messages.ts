export interface ReportValidationPanelMessages {
  title: string;
  error: string;
  warning: string;
  locate: string;
  dataset: string;
  row: string;
  /** Kept for existing message overrides; every issue is now reachable by pagination. */
  more: string;
  search: string;
  searchPlaceholder: string;
  severity: string;
  allSeverities: string;
  datasetFilter: string;
  allDatasets: string;
  results: string;
  range: string;
  previous: string;
  next: string;
  page: string;
  empty: string;
  noMatches: string;
  clear: string;
  loading: string;
  unavailable: string;
}

export const DEFAULT_VALIDATION_PANEL_MESSAGES: ReportValidationPanelMessages = {
  title: "数据校验", error: "错误", warning: "提示", locate: "定位", dataset: "全表", row: "行", more: "请缩小范围查看更多问题",
  search: "搜索校验问题", searchPlaceholder: "搜索问题、字段或业务键", severity: "问题级别", allSeverities: "全部级别", datasetFilter: "数据集", allDatasets: "全部数据集",
  results: "匹配 {matched} 项 · 共 {total} 项", range: "{start}–{end} / {count}", previous: "上一页", next: "下一页", page: "第 {page} 页，共 {pages} 页",
  empty: "暂无校验问题", noMatches: "没有匹配的校验问题", clear: "清除筛选", loading: "正在校验…", unavailable: "当前结果中没有可定位的业务单元格"
};

export function resolveValidationPanelMessages(overrides?: Partial<ReportValidationPanelMessages>): ReportValidationPanelMessages {
  const messages = { ...DEFAULT_VALIDATION_PANEL_MESSAGES };
  for (const key of Object.keys(messages) as Array<keyof ReportValidationPanelMessages>) {
    if (overrides?.[key] !== undefined) messages[key] = overrides[key]!;
  }
  return messages;
}

export function validationPanelText(message: string, values: Record<string, string | number>): string {
  return message.replace(/\{(\w+)\}/g, (token, key: string) => values[key] === undefined ? token : String(values[key]));
}
