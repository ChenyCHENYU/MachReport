import type { ReportTemplateDocument } from "../source/template-registry";
import type { TemplateToolDraft } from "./draft-storage";

interface PendingJson {
  text: string;
  revision?: string;
}
export interface TemplateHistoryState {
  document: Omit<ReportTemplateDocument, "revision">;
  json?: PendingJson;
  tools: Record<string, TemplateToolDraft>;
}

/** Persistence revisions belong to the current baseline, outside reversible content. */
export function serializeTemplateHistory(
  document: ReportTemplateDocument,
  tools: Record<string, TemplateToolDraft>,
  json?: PendingJson,
): string {
  const content = { ...document, revision: undefined };
  return JSON.stringify({ document: content, tools, json } satisfies TemplateHistoryState);
}

export function restoreTemplateHistoryDocument(
  state: TemplateHistoryState,
  baseline: ReportTemplateDocument,
): ReportTemplateDocument {
  const document: ReportTemplateDocument = { ...baseline, ...state.document, id: baseline.id };
  if (state.document.description === undefined) delete document.description;
  if (baseline.revision === undefined) delete document.revision;
  else document.revision = baseline.revision;
  return document;
}
