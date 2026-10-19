// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { createTableTemplate } from "../builder/table-template";
import { defineReportTemplate } from "../source/template-registry";
import { reviewReportPublication } from "../server/publication";
import type { ReportPublicationOptions } from "../server/publication";
import { reportArtifactSha256 } from "../server/node";

const document = () => defineReportTemplate({ id: "publication", name: "Daily", template: createTableTemplate({ columns: [{ field: "code", header: "Code" }, { field: "weight", header: "Weight", format: { kind: "number", digits: 2 } }] }) });
const fixtures = [{ name: "zero-and-null", datasets: { detail: [{ code: "001", weight: 0 }, { code: "002", weight: null }] } }];
describe("publication output gate", () => {
  it("actually encodes and reads back PDF and Excel while retaining only artifact metadata", async () => {
    const seen: string[] = [];
    const review = await reviewReportPublication(document(), { fixtures, xlsx: { valueMode: "raw" }, digest: reportArtifactSha256, onArtifact: async (name, result) => {
      seen.push(name + ":" + result.format);
      if (result.format === "pdf") expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(result.stats.pages);
      else {
        const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(result.bytes as unknown as ArrayBuffer);
        const values: unknown[] = []; workbook.worksheets[0]!.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
        expect(values).toContain(0); expect(values).toContain("001");
      }
    } });
    expect(review.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(review.ok).toBe(true); expect(seen).toEqual(["zero-and-null:pdf", "zero-and-null:xlsx"]);
    expect(review.artifacts).toHaveLength(2);
    expect(review.artifacts.every((item) => item.bytes > 100 && /^[a-f0-9]{64}$/.test(item.digest!))).toBe(true);
    expect(review.artifacts[0]).not.toHaveProperty("buffer");
  });

  it("blocks over-budget outputs and does not claim encoding when samples are absent", async () => {
    const failed = await reviewReportPublication(document(), { fixtures, formats: ["xlsx"], maxOutputBytes: 1 });
    expect(failed.ok).toBe(false); expect(failed.artifacts).toHaveLength(0);
    expect(failed.issues).toContainEqual(expect.objectContaining({ code: "output", severity: "error" }));
    const structural = await reviewReportPublication(document());
    expect(structural.artifacts).toEqual([]);
    expect(structural.issues).toContainEqual(expect.objectContaining({ code: "sample", severity: "warning" }));
  });

  it("aborts explicitly and blocks archiving errors before publication", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(reviewReportPublication(document(), { fixtures, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    const failed = await reviewReportPublication(document(), { fixtures, formats: ["pdf"], onArtifact: () => { throw new Error("archive unavailable"); } });
    expect(failed.ok).toBe(false); expect(failed.artifacts).toHaveLength(0);
    expect(failed.issues.some((item) => item.message.includes("archive unavailable"))).toBe(true);
  });

  it("rejects non-file formats and allows cancellation while a host digest never settles", async () => {
    const invalid = await reviewReportPublication(document(), { fixtures, formats: ["canvas"] } as unknown as ReportPublicationOptions);
    expect(invalid.ok).toBe(false); expect(invalid.artifacts).toEqual([]);
    const controller = new AbortController();
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const review = reviewReportPublication(document(), { fixtures, formats: ["pdf"], signal: controller.signal, digest: () => { entered(); return new Promise<string>(() => undefined); } });
    const rejected = expect(review).rejects.toMatchObject({ name: "AbortError" });
    await waiting; controller.abort(); await rejected;
  });
});
