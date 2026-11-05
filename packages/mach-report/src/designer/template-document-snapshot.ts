import { computed, type Ref } from "vue";
import { ReportTemplateError, validateReportTemplateDocument, type ReportTemplateDocument, type ValidationResult } from "@agile-team/mach-report";
import { stringifyValidatedTemplate } from "../source/template-serialization";

interface TemplateDocumentSnapshot {
  validation: ValidationResult;
  json?: string;
}

/** One reactive validation/serialization is shared by dirty state, JSON and outgoing snapshots. */
export function useTemplateDocumentSnapshot(document: Ref<ReportTemplateDocument>) {
  return computed<TemplateDocumentSnapshot>(() => {
    const validation = validateReportTemplateDocument(document.value);
    if (!validation.ok) return { validation };
    try { return { validation, json: stringifyValidatedTemplate(document.value) }; }
    catch (cause) {
      return { validation: { ok: false, warnings: validation.warnings, errors: [{ path: "$", message: cause instanceof Error ? cause.message : String(cause) }] } };
    }
  });
}

/** Every caller gets its own mutable copy. Hosts cannot mutate the cached editor state. */
export function copyTemplateDocumentSnapshot(snapshot: TemplateDocumentSnapshot): ReportTemplateDocument {
  if (snapshot.json === undefined) throw new ReportTemplateError(snapshot.validation.errors);
  return JSON.parse(snapshot.json) as ReportTemplateDocument;
}
