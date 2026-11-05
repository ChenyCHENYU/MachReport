// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createTableTemplate, defineReportTemplate, ReportTemplateError } from "../../index";
import * as serialization from "../../source/template-serialization";
import { copyTemplateDocumentSnapshot, useTemplateDocumentSnapshot } from "../template-document-snapshot";

function document() {
  return defineReportTemplate({ id: "snapshot", name: "Snapshot", revision: "2", template: createTableTemplate({ columns: [{ header: "Amount", field: "amount" }] }) });
}

describe("validated editor snapshots", () => {
  it("shares one serialization and returns isolated mutable copies", () => {
    const draft = ref(document()), snapshot = useTemplateDocumentSnapshot(draft);
    const stringify = vi.spyOn(serialization, "stringifyValidatedTemplate");
    try {
      const first = snapshot.value;
      const copied = copyTemplateDocumentSnapshot(first);
      copied.name = "External mutation";
      copied.template.pages[0]!.widthMm = 100;
      for (let index = 0; index < 100; index++) expect(snapshot.value).toBe(first);
      expect(draft.value.name).toBe("Snapshot");
      expect(stringify).toHaveBeenCalledTimes(1);
      draft.value.template.pages[0]!.widthMm += 1;
      expect(snapshot.value).not.toBe(first);
      expect(stringify).toHaveBeenCalledTimes(2);
      expect(copyTemplateDocumentSnapshot(snapshot.value).revision).toBe("2");
    } finally { stringify.mockRestore(); }
  });

  it("retains invalid input and refuses to emit a validated copy until corrected", () => {
    const draft = ref(document()), snapshot = useTemplateDocumentSnapshot(draft);
    expect(snapshot.value.validation.ok).toBe(true);
    draft.value.name = "";
    expect(snapshot.value.validation.ok).toBe(false);
    expect(snapshot.value.json).toBeUndefined();
    expect(() => copyTemplateDocumentSnapshot(snapshot.value)).toThrow(ReportTemplateError);
    draft.value.name = "Corrected";
    expect(copyTemplateDocumentSnapshot(snapshot.value).name).toBe("Corrected");
    draft.value.template.pages[0]!.widthMm = -1;
    expect(snapshot.value.validation.ok).toBe(false);
  });

  it("applies the formatted JSON size limit even when content text fits its separate budget", () => {
    const draft = ref(document());
    draft.value.description = "a".repeat(9_999_700);
    const snapshot = useTemplateDocumentSnapshot(draft);
    expect(snapshot.value.validation.ok).toBe(false);
    expect(snapshot.value.validation.errors[0]!.message).toContain("1000 万字符");
    expect(() => copyTemplateDocumentSnapshot(snapshot.value)).toThrow(ReportTemplateError);
  });
});
