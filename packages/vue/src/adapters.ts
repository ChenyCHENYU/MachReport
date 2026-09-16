import type { RenderPlan } from "@mach-report/core";

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

export function createJh4jGridPlanFetcher(options: {
  request: (config: { url: string; method: string; params?: Record<string, string> }) => Promise<unknown>;
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
