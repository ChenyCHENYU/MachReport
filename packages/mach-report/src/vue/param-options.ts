export interface ReportParamOption { readonly label: string; readonly value: string; readonly children?: readonly ReportParamOption[] }
export interface ReportParamOptionsInput {
  readonly source: string;
  readonly field: string;
  readonly query: string;
  /** Only declared dependencies, captured at request start. Never the mutable form. */
  readonly params: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly limit: number;
}
/** Resolve a trusted source key through the host's existing API/authentication. */
export type ReportParamOptionsLoader = (input: ReportParamOptionsInput) => Promise<readonly ReportParamOption[]>;
export interface ReportParamOptionsMessages {
  paramOptionsLoading?: string;
  paramOptionsEmpty?: string;
  paramOptionsFailed?: string;
  paramOptionsMissingLoader?: string;
  paramOptionsDependencies?: string;
  paramOptionsClear?: string;
  paramNumberRangeStart?: string;
  paramNumberRangeEnd?: string;
}
export const PARAM_OPTIONS_MESSAGES: Required<ReportParamOptionsMessages> = {
  paramOptionsLoading: "正在搜索选项…", paramOptionsEmpty: "没有匹配选项",
  paramOptionsFailed: "选项加载失败，请重试", paramOptionsMissingLoader: "尚未配置选项加载服务",
  paramOptionsDependencies: "请先选择上级条件", paramOptionsClear: "清除选择", paramNumberRangeStart: "最小值", paramNumberRangeEnd: "最大值",
};
