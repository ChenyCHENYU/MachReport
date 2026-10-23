// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTableTemplate } from "../builder/table-template";
import { createReportRuntime } from "../server/runtime";
import { createReportGenerationService } from "../server/generation";
import { createMemoryReportInstanceStore } from "../server/instance-store";
import { createMemoryReportJobStore } from "../server/job-store";
import { createReportJobService } from "../server/job-service";
import { validReportWorkerResult } from "../worker/protocol";

const template = createTableTemplate({ columns: [{ field: "value", header: "Value" }] });
describe("runtime request and occurrence identity", () => {
  it("captures mutable IDs and params before prepare fonts or PDF export yields", async () => {
    const calls: unknown[] = [];
    const definition = { template, params: [{ field: "day", type: "date" as const }], load: (context: { reportId: string; params: Record<string, string> }) => {
      calls.push([context.reportId, context.params.day]); return { detail: [{ value: "A" }] };
    } };
    const runtime = createReportRuntime({ reports: { one: definition, two: definition } });
    const pdf = { customFontBytes: readFileSync(new URL("../../../../examples/minimal/public/fonts/mach-report-demo.otf", import.meta.url)) };
    for (const mode of ["prepare", "export"] as const) {
      const reportIds = ["one"], params = { day: "2026-10-01" };
      const pending = mode === "prepare" ? runtime.prepare({ reportIds, params, pdf }) : runtime.export({ reportIds, params, format: "pdf" });
      reportIds[0] = "two"; params.day = "2026-10-02";
      await pending;
    }
    expect(calls).toEqual([["one", "2026-10-01"], ["one", "2026-10-01"]]);
  });
  it("retains every repeated-ID source and scopes its diagnostics independently", async () => {
    let count = 0;
    const runtime = createReportRuntime({ reports: { report: { template, provider: { query: () => ({ datasets: { detail: [{ value: ++count }] }, revision: `r${count}`, sourceToken: `s${count}`,
      diagnostics: [{ code: "source", severity: "info", message: "No source", target: { datasetId: "detail", field: "value", tableId: "detail" }, valueState: "missing-source" }] }) } } } });
    const prepared = await runtime.prepare({ reportIds: ["report", "report"] });
    expect(prepared.sources).toEqual([0, 1].map(index => ({ reportId: "report", reportIndex: index, reportScope: JSON.stringify([index, "report"]), revision: `r${index + 1}`, sourceToken: `s${index + 1}` })));
    expect(prepared.revisions.report?.revision).toBe("r2");
    expect(prepared.diagnostics.map(entry => entry.target?.reportScope)).toEqual(['[0,"report"]', '[1,"report"]']);
    expect(prepared.diagnostics[1]?.target?.tableId).toBe('[1,"report","detail"]');
    expect(validReportWorkerResult(prepared, "prepare")).toBe(true);
    prepared.sources![1]!.reportIndex = 0;
    expect(validReportWorkerResult(prepared, "prepare")).toBe(false);
    await expect(runtime.exportPrepared({ prepared, format: "xlsx" })).rejects.toThrow("来源清单无效");
  });
  it("archives source provenance without transient tokens", async () => {
    const runtime = createReportRuntime({ reports: { report: { template, sourceScope: "shared:production", provider: { query: () => ({ datasets: { detail: [] }, revision: "r1", sourceToken: "private" }) } } } });
    const service = createReportGenerationService({ runtime, instances: createMemoryReportInstanceStore(), templateRevisions: { report: "v1" } });
    const saved = await service.generate({ scope: "test", id: "report", title: "Report", reportIds: ["report"], expectedRevision: null });
    expect(saved.output?.sources).toEqual([{ reportId: "report", reportIndex: 0, reportScope: '[0,"report"]', revision: "r1" }]);
    expect(JSON.stringify(saved)).not.toContain("private");
  });
  it("passes immutable claim identity to handlers for host artifact fencing", async () => {
    const observed: Array<{ attempt: number; executionToken: string }> = [];
    let fail = true;
    const service = createReportJobService({ store: createMemoryReportJobStore(), handlers: { demo: (_payload, context) => {
      observed.push({ attempt: context.attempt, executionToken: context.executionToken });
      if (fail) throw new Error("first attempt"); return { artifact: "safe-key" };
    } } });
    await service.submit({ scope: "audit", id: "job", kind: "demo", payload: {} });
    const first = await service.runNext("node"); fail = false;
    await service.retry("audit", "job", first!.revision);
    await service.runNext("node"); await service.close();
    expect(observed).toEqual([{ attempt: 1, executionToken: '["audit","job",1]' }, { attempt: 2, executionToken: '["audit","job",2]' }]);
  });
});
