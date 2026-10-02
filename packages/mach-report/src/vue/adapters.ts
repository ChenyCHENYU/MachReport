import type { RenderPlan } from "@agile-team/mach-report";

export type ReportIdInput = string | string[] | null | undefined;

export interface PlanFetcher {
  (input: { reportIds: string[]; params: Record<string, string> }): Promise<RenderPlan>;
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
}) => Promise<unknown>;

export interface FetchRequestOptions {
  /** 网关前缀（默认空 = 同源） */
  baseUrl?: string;
  /** 附加请求头（如鉴权 token） */
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  /** 超时毫秒（默认 30000；超时抛 PlanLoadError） */
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
  return async ({ url, method, params }) => {
    const qs = params && Object.keys(params).length > 0 ? `?${new URLSearchParams(params)}` : "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${prefix}${url}${qs}`, {
        method: method.toUpperCase(),
        headers: { Accept: "application/json", ...headers },
        credentials,
        signal: controller.signal
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new PlanLoadError(`请求超时(${timeoutMs}ms): ${url}`);
      }
      throw new PlanLoadError(`请求失败(${url}): ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new PlanLoadError(`HTTP ${res.status} ${url}`);
    }
    return res.json();
  };
}
