export class PaginatePageLimitError extends Error {
  readonly code = "page-limit";
  constructor(readonly limit: number, readonly actual: number) {
    super(`报表页数超出上限 ${limit}（至少 ${actual} 页）`);
    this.name = "PaginatePageLimitError";
  }
}

export class PaginateCellLimitError extends Error {
  readonly code = "cell-limit";
  constructor(readonly limit: number, readonly actual: number) {
    super(`报表单元格数量超出上限 ${limit}（至少 ${actual} 格）`);
    this.name = "PaginateCellLimitError";
  }
}

export class PaginateChartComponentLimitError extends Error {
  readonly code = "chart-component-limit";
  constructor(readonly limit: number, readonly estimated: number) {
    super(`报表图表图元数量预计超出上限 ${limit}（本次估算 ${estimated}）`);
    this.name = "PaginateChartComponentLimitError";
  }
}
