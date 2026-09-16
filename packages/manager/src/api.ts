import type {
  ApiResponse,
  DatasetRecord,
  ImportStrategy,
  PageResult,
  ParamRecord,
  ReportRecord,
  RequestFn
} from "./types";
import { ReportAdminError } from "./types";

const BASE = "/report/codePrintReport";
const LOCK_BASE = "/report/codePrintReportLock";

function unwrap<T>(response: unknown, url: string): T {
  const body = response as ApiResponse<T>;
  if (body && body.code != null && body.code !== 200) {
    throw new ReportAdminError(String(body.message || "请求失败"), url);
  }
  return (body?.data ?? body) as T;
}

export function createReportAdminClient(options: { request: RequestFn; baseUrl?: string }) {
  const { request } = options;
  const base = options.baseUrl ?? "";

  return {
    /** 模板列表（分页） */
    async listReports(query: {
      current?: number;
      size?: number;
      directoryId?: string;
      keyword?: string;
    } = {}): Promise<PageResult<ReportRecord>> {
      const url = `${base}${BASE}/list`;
      return unwrap<PageResult<ReportRecord>>(
        await request({ url, method: "get", params: { current: 1, size: 20, ...query } }),
        url
      );
    },

    /** 模板详情（content 为 jh4j 私有模板 JSON 字符串，可喂给 importJh4jTemplateContent） */
    async getReport(id: string): Promise<ReportRecord> {
      const url = `${base}${BASE}/getById`;
      return unwrap<ReportRecord>(await request({ url, method: "get", params: { id } }), url);
    },

    /** 保存模板（jh4j：PUT，body {id, code, name, content}） */
    async updateReport(input: {
      id: string;
      code?: string;
      name?: string;
      content: string;
    }): Promise<unknown> {
      const url = `${base}${BASE}/update`;
      return unwrap(await request({ url, method: "put", data: input }), url);
    },

    /** 导出模板定义包（body = ID 数组，返回 ZIP blob） */
    async exportDefinition(ids: string[]): Promise<unknown> {
      const url = `${base}${BASE}/exportDefinition`;
      return request({ url, method: "post", data: ids });
    },

    /** 导入模板定义包（multipart: file + strategy） */
    async importDefinition(file: File | Blob, strategy: ImportStrategy): Promise<unknown> {
      const url = `${base}${BASE}/importDefinition`;
      const form = new FormData();
      form.append("file", file);
      form.append("strategy", strategy);
      return request({ url, method: "post", data: form });
    },

    /** 数据集列表 */
    async listDatasets(reportId: string): Promise<PageResult<DatasetRecord>> {
      const url = `${base}${BASE}Ds/list`;
      return unwrap<PageResult<DatasetRecord>>(
        await request({ url, method: "get", params: { reportId, current: 1, size: 999 } }),
        url
      );
    },

    /** 参数列表 */
    async listParams(reportId: string): Promise<PageResult<ParamRecord>> {
      const url = `${base}${BASE}Param/list`;
      return unwrap<PageResult<ParamRecord>>(
        await request({ url, method: "get", params: { reportId, current: 1, size: 999 } }),
        url
      );
    },

    /** 模板锁：进入设计器前获取（40s 心跳由 holdLock 驱动） */
    async acquireLock(reportId: string): Promise<unknown> {
      const url = `${base}${LOCK_BASE}/acquire`;
      return unwrap(await request({ url, method: "post", data: { reportId } }), url);
    },

    async lockHeartbeat(reportId: string): Promise<unknown> {
      const url = `${base}${LOCK_BASE}/heartbeat`;
      return unwrap(await request({ url, method: "post", data: { reportId } }), url);
    },

    async releaseLock(reportId: string): Promise<unknown> {
      const url = `${base}${LOCK_BASE}/release`;
      return unwrap(await request({ url, method: "post", data: { reportId } }), url);
    },

    /**
     * 持锁执行：acquire → fn（期间自动心跳）→ release（finally）。
     * 返回 fn 的结果；获取锁失败时抛 ReportAdminError。
     */
    async holdLock<T>(reportId: string, fn: () => Promise<T>): Promise<T> {
      await this.acquireLock(reportId);
      const timer = setInterval(() => {
        void this.lockHeartbeat(reportId).catch(() => undefined);
      }, 40_000);
      try {
        return await fn();
      } finally {
        clearInterval(timer);
        await this.releaseLock(reportId).catch(() => undefined);
      }
    }
  };
}

export type ReportAdminClient = ReturnType<typeof createReportAdminClient>;
