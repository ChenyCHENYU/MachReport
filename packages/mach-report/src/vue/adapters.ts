import type { ReportFetcher, ReportFetchInput, RenderPlan } from "@agile-team/mach-report";

export type ReportIdInput = string | string[] | null | undefined;

export interface PlanFetcher {
  (input: ReportFetchInput): Promise<RenderPlan>;
  getParamDefs?: ReportFetcher["getParamDefs"];
}

export function normalizeReportIds(reportId: ReportIdInput): string[] {
  if (reportId == null) return [];
  if (Array.isArray(reportId)) return reportId.map(String).filter((s) => s !== "");
  return String(reportId)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function joinReportIds(reportId: ReportIdInput): string {
  return normalizeReportIds(reportId).join(",");
}

export class PlanLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanLoadError";
  }
}

/** 通用请求函数签名（可适配 Axios 风格客户端） */
export type HostRequest = (config: {
  url: string;
  method: string;
  params?: Record<string, string>;
  /** 取消单次请求；可与内置超时一起使用 */
  signal?: AbortSignal;
}) => Promise<unknown>;

export interface FetchRequestOptions {
  /** 网关前缀（默认空 = 同源） */
  baseUrl?: string;
  /** 附加请求头（如鉴权 token） */
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  /** 完整请求（含 JSON 响应体）的超时毫秒（默认 30000；超时抛 PlanLoadError） */
  timeoutMs?: number;
}

/**
 * 零依赖请求适配器：用全局 fetch 实现 HostRequest 签名，
 * 供自定义 PlanFetcher 按需调用，不预设任何报表接口路径或响应包装。
 * 内置超时（AbortController）与网络/HTTP 错误语义。
 */
export function createFetchRequest(options: FetchRequestOptions = {}): HostRequest {
  const { baseUrl = "", headers, credentials, timeoutMs = 30_000 } = options;
  const prefix = baseUrl.replace(/\/+$/, "");
  return async ({ url, method, params, signal }) => {
    let requestUrl = `${prefix}${url}`;
    if (params && Object.keys(params).length > 0) {
      const hashIndex = requestUrl.indexOf("#");
      const hash = hashIndex >= 0 ? requestUrl.slice(hashIndex) : "";
      const withoutHash = hashIndex >= 0 ? requestUrl.slice(0, hashIndex) : requestUrl;
      const queryIndex = withoutHash.indexOf("?");
      const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
      const query = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "");
      for (const [key, value] of Object.entries(params)) query.set(key, value);
      requestUrl = `${path}?${query}${hash}`;
    }

    const loadError = (message: string, cause: unknown): PlanLoadError => {
      const error = new PlanLoadError(message);
      Object.defineProperty(error, "cause", { value: cause, configurable: true, writable: true });
      return error;
    };
    if (signal?.aborted) {
      throw loadError(`请求已取消: ${url}`, signal.reason);
    }

    const controller = new AbortController();
    let abortSource: "timeout" | "external" | undefined;
    const abortRequest = () => {
      if (controller.signal.aborted) return;
      abortSource = "external";
      controller.abort(signal?.reason);
    };
    signal?.addEventListener("abort", abortRequest, { once: true });
    const timer = setTimeout(() => {
      if (controller.signal.aborted) return;
      abortSource = "timeout";
      controller.abort();
    }, timeoutMs);
    try {
      const res = await fetch(requestUrl, {
        method: method.toUpperCase(),
        headers: { Accept: "application/json", ...headers },
        credentials,
        signal: controller.signal
      });
      if (!res.ok) {
        throw new PlanLoadError(`HTTP ${res.status} ${url}`);
      }
      return await res.json();
    } catch (e) {
      if (abortSource === "timeout") {
        throw loadError(`请求超时(${timeoutMs}ms): ${url}`, e);
      }
      if (abortSource === "external") {
        throw loadError(`请求已取消: ${url}`, e);
      }
      if (e instanceof PlanLoadError) throw e;
      throw loadError(`请求失败(${url}): ${e instanceof Error ? e.message : String(e)}`, e);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortRequest);
    }
  };
}
