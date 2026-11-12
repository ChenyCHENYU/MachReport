import { readReportDocumentPages, ReportDocumentError, type ReportDocumentManifest, type ReportDocumentStore } from "./document-store";
import type { PlanPage } from "../schema/render-plan";
import type { ReportRuntimeExportResult } from "./types";

export interface ReportDocumentWindowRequest {
  /** Omit only when opening or explicitly refreshing a document. */
  version?: string;
  /** Zero-based global page offset. */
  fromPage: number;
  limit: number;
  signal?: AbortSignal;
}
export interface ReportDocumentWindow {
  manifest: ReportDocumentManifest;
  pages: PlanPage[];
  nextPage: number;
}
export interface ReportDocumentExportRequest {
  version: string;
  format: "pdf" | "xlsx";
  signal?: AbortSignal;
}
/** Host-authorized transport. Export must encode the complete pinned document. */
export interface ReportDocumentSource {
  load(input: ReportDocumentWindowRequest): Promise<ReportDocumentWindow>;
  export?(input: ReportDocumentExportRequest): Promise<ReportRuntimeExportResult>;
}

/** Bind an existing document store; HTTP clients can implement the same two-method contract. */
export function createReportDocumentSource(
  store: ReportDocumentStore,
  identity: { scope: string; id: string },
  options: { export?: ReportDocumentSource["export"] } = {}
): ReportDocumentSource {
  const { scope, id } = identity;
  return {
    async load(input) {
      const request = { ...input };
      const version = request.version ?? (await store.read(scope, id, request.signal))?.version;
      if (!version) throw new ReportDocumentError("missing", "文档不存在");
      return readReportDocumentPages(store, { ...request, scope, id, version });
    },
    ...(options.export ? { export: options.export } : {})
  };
}
