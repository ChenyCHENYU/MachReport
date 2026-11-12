import { RENDER_PLAN_SCHEMA_VERSION, type PlanPage } from "../../schema/render-plan";
import type { ReportDocumentWindow } from "../../server/document-source";

export const page = (index: number): PlanPage => ({ pageWidthMm: 80, pageHeightMm: 55, components: [{ kind: "text", leftMm: 5, topMm: 5, widthMm: 60, heightMm: 10, text: `Page ${index + 1}` }] });
export function windowAt(from: number, count = 10_000, version = "v1"): ReportDocumentWindow {
  const pages = Array.from({ length: Math.min(3, Math.max(0, count - from)) }, (_, offset) => page(from + offset));
  return { manifest: { scope: "tenant", id: "document", version, revision: count + 1, state: "complete", bytes: 100, pageCount: count, plan: { schemaVersion: RENDER_PLAN_SCHEMA_VERSION } }, pages, nextPage: Math.min(from, count) + pages.length };
}
