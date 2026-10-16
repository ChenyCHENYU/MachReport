// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { renderPlanToXlsx } from "../xlsx";
import { renderPlanToPdf } from "../pdf";
import { importExcelTemplate } from "../xlsx/import-template";
import { notifyOutputProgress, waitForOutput } from "../output/progress";
import type { RenderPlan } from "../index";

const plan: RenderPlan = { schemaVersion: "output-task", pages: Array.from({ length: 3 }, () => ({ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "text" as const, leftMm: 1, topMm: 1, widthMm: 60, heightMm: 8, text: "0001 / 0 / 12.5" }] })) };
describe("output stages and cancellation", () => {
  it.each(["pdf", "xlsx", "import"] as const)("%s rejects an already-cancelled request before reading or encoding", async (format) => {
    const controller = new AbortController(); controller.abort();
    const operation = format === "pdf" ? renderPlanToPdf(plan, { signal: controller.signal }) : format === "xlsx" ? renderPlanToXlsx(plan, { signal: controller.signal }) : importExcelTemplate(new Uint8Array(), { signal: controller.signal });
    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
  });
  it.each(["pdf", "xlsx"] as const)("%s stops between completed units and never publishes a partial file", async (format) => {
    const controller = new AbortController(); const seen: number[] = [];
    const options = { signal: controller.signal, onProgress: (completed: number, total: number) => { seen.push(completed); expect(total).toBe(3); controller.abort(); } };
    await expect(format === "pdf" ? renderPlanToPdf(plan, options) : renderPlanToXlsx(plan, options)).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual([1]);
  });
  it("isolates progress observers and still produces a real complete workbook", async () => {
    const onProgress = vi.fn(() => { throw new Error("observer unavailable"); });
    const result = await renderPlanToXlsx(plan, { onProgress });
    expect(onProgress).toHaveBeenCalledTimes(3); expect(result.workbook.worksheets).toHaveLength(3); expect(result.buffer.byteLength).toBeGreaterThan(1000);
  });
  it("settles cancellation even if an adapter never settles, and consumes late rejection", async () => {
    const controller = new AbortController(); let reject!: (cause: unknown) => void;
    const pending = waitForOutput(new Promise<void>((_yes, no) => { reject = no; }), controller.signal);
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    reject(new Error("late rejection")); await Promise.resolve();
    expect(() => notifyOutputProgress({ onProgress: () => { throw new Error("observer"); } }, 1, 2)).not.toThrow();
  });
  it("consumes an adapter rejection even when it synchronously cancels before returning", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(waitForOutput(Promise.reject(new Error("late adapter failure")), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
