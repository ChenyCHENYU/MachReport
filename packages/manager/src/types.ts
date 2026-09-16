export interface ReportRecord {
  id: string;
  code?: string;
  name?: string;
  publishStatus?: string;
  directoryId?: string;
  updateTime?: string;
  [key: string]: unknown;
}

export interface PageResult<T> {
  records: T[];
  total?: number;
  current?: number;
  size?: number;
}

export interface DatasetRecord {
  id?: string;
  reportId?: string;
  code?: string;
  name?: string;
  type?: string;
  datasourceCode?: string;
  sqlText?: string;
  apiUrl?: string;
  fields?: unknown[];
  [key: string]: unknown;
}

export interface ParamRecord {
  id?: string;
  reportId?: string;
  name?: string;
  defaultValue?: string;
  [key: string]: unknown;
}

export type ImportStrategy = "overwrite" | "skip";

export type RequestFn = (config: {
  url: string;
  method: string;
  params?: Record<string, unknown>;
  data?: unknown;
}) => Promise<unknown>;

export interface ApiResponse<T = unknown> {
  code?: number;
  message?: string;
  data?: T;
}

export class ReportAdminError extends Error {
  constructor(message: string, public readonly url: string) {
    super(message);
    this.name = "ReportAdminError";
  }
}
