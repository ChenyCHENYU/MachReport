import type { RenderPlan } from "@agile-team/mach-report";

export type TempIdInput = string | string[] | null | undefined;

export interface PlanFetcher {
  (input: { tempIds: string[]; furnitureTempId?: string; params: Record<string, string> }): Promise<RenderPlan>;
}

export function normalizeTempIds(tempId: TempIdInput): string[] {
  if (tempId == null) return [];
  if (Array.isArray(tempId)) return tempId.map(String).filter((s) => s !== "");
  return String(tempId)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function joinTempIds(tempId: TempIdInput): string {
  return normalizeTempIds(tempId).join(",");
}

export class PlanLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanLoadError";
  }
}

/** 宿主请求函数签名（axios 风格；createJh4jGridPlanFetcher 消费） */
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
 * 让宿主无需引入 axios 或手写胶水代码即可接上 jh4j 数据面。
 * 内置超时（AbortController）与网络/HTTP 错误语义。
 */
export function createFetchRequest(options: FetchRequestOptions = {}): HostRequest {
  const { baseUrl = "", headers, credentials, timeoutMs = 30_000 } = options;
  return async ({ url, method, params }) => {
    const qs = params && Object.keys(params).length > 0 ? `?${new URLSearchParams(params)}` : "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${url}${qs}`, {
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

export function createJh4jGridPlanFetcher(options: {
  request: HostRequest;
  /** 网关前缀，默认空（同域） */
  baseUrl?: string;
}): PlanFetcher {
  const { request, baseUrl = "" } = options;
  return async ({ tempIds, furnitureTempId, params }) => {
    if (tempIds.length === 0) throw new PlanLoadError("缺少报表模板 ID");
    const query: Record<string, string> = { tempId: tempIds.join(",") };
    if (furnitureTempId) query.furnitureTempId = furnitureTempId;
    for (const [k, v] of Object.entries(params || {})) {
      if (k && v != null && v !== "") query[k] = String(v);
    }
    const body = (await request({
      url: `${baseUrl}/report/codePrintReport/gridPlan`,
      method: "get",
      params: query
    })) as { code?: number; message?: string; data?: { pages?: unknown } | null };
    if (body && body.code != null && body.code !== 200) {
      throw new PlanLoadError(String(body.message || "预览加载失败"));
    }
    const pages = body?.data?.pages;
    return {
      schemaVersion: "jh4j-compatible",
      pages: Array.isArray(pages) ? (pages as RenderPlan["pages"]) : []
    };
  };
}
