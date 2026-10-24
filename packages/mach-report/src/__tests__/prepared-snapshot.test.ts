// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { snapshotReportJson } from "../schema/json-snapshot";
import { capturePreparedHandoff, snapshotPreparedReport } from "../server/prepared";
import { createAutoReportExporter } from "../worker/auto";
import type { PreparedReport, ReportRuntimeExportResult } from "../server/types";

const maxBytes = 64_000_000;
const prepared = (rows = 1, columns = 1): PreparedReport => ({
  plan: { schemaVersion: "mach-report/1", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{
    kind: "text", leftMm: 0, topMm: 0, widthMm: 90, heightMm: 90,
    grid: { cells: Array.from({ length: rows }, () => Array.from({ length: columns }, () => ({
      text: "Original", value: 0, style: { align: "right" as const, verticalAlign: "middle" as const, fontSizePx: 10, bold: false }
    }))) }
  }] }] }, stats: { rows, pages: 1, cells: 0, durationMs: 0 }, diagnostics: [], revisions: {}, layout: { textMetrics: "heuristic" }
});
const cell = (value: PreparedReport) => value.plan.pages[0]!.components[0]!.grid!.cells[0]![0]!;
const result = (value: PreparedReport): ReportRuntimeExportResult => ({ bytes: new Uint8Array([1]), format: "xlsx", contentType: "application/octet-stream", stats: value.stats, diagnostics: [], revisions: {} });

describe("Prepared geometry snapshot ownership and budgets", () => {
  it("accepts a styled 82 × 2001 grid within byte/cell budgets while generic JSON keeps its node cap", async () => {
    const value = prepared(2001, 82);
    expect(() => snapshotReportJson(value, { maxBytes, error: (_code, message) => new Error(message) })).toThrow("节点");
    const encode = vi.fn(async request => result(request.prepared));
    const output = await createAutoReportExporter({ mode: "local" }).exportPrepared({ prepared: value, format: "xlsx" }, encode);
    expect(output.stats.cells).toBe(164_082);
    expect(encode).toHaveBeenCalledOnce();
    expect(encode.mock.calls[0]![0].prepared).not.toBe(value);
    await expect(createAutoReportExporter({ mode: "local", budget: { maxPreparedBytes: 1000 } }).exportPrepared({ prepared: value, format: "xlsx" }, encode)).rejects.toMatchObject({ code: "budget", path: "$.budget.maxPreparedBytes" });
  });
  it("checks actual cells even when a private first-import snapshot is handed over", async () => {
    const handoff = capturePreparedHandoff(prepared(2, 2), maxBytes);
    const encode = vi.fn();
    await expect(createAutoReportExporter({ mode: "local", budget: { maxCells: 3 } }).exportPrepared({ prepared: handoff.forward(), format: "xlsx" }, encode)).rejects.toMatchObject({ code: "budget", path: "$.budget.maxCells" });
    expect(encode).not.toHaveBeenCalled();
  });
  it("private handoff is consumed once, rechecks tighter budgets, and never brands the host input", () => {
    const host = prepared();
    const handoff = capturePreparedHandoff(host, maxBytes);
    cell(host).text = "Changed host";
    const forwarded = handoff.forward();
    expect(cell(forwarded).text).toBe("Original");
    expect(snapshotPreparedReport(forwarded, maxBytes)).toBe(forwarded);
    expect(snapshotPreparedReport(forwarded, maxBytes)).not.toBe(forwarded);
    expect(snapshotPreparedReport(host, maxBytes)).not.toBe(host);
    expect(() => handoff.forward()).toThrow("一次");
    const smaller = capturePreparedHandoff(host, maxBytes).forward();
    expect(() => snapshotPreparedReport(smaller, 20)).toThrow("字节预算");
    const invalid = capturePreparedHandoff(host, maxBytes).forward();
    expect(() => snapshotPreparedReport(invalid, Infinity)).toThrow("正安全整数");
  });
  it("captures every public invocation before decision observers mutate the original plan", async () => {
    const host = prepared();
    const observed: string[] = [];
    const exporter = createAutoReportExporter({ mode: "local", onDecision: () => { cell(host).text = "Observer mutation"; } });
    const encode = async (request: { prepared: PreparedReport }) => { observed.push(cell(request.prepared).text!); return result(request.prepared); };
    const first = exporter.exportPrepared({ prepared: host, format: "xlsx" }, encode);
    cell(host).text = "Second invocation";
    const second = exporter.exportPrepared({ prepared: host, format: "xlsx" }, encode);
    await Promise.all([first, second]);
    expect(observed).toEqual(["Original", "Second invocation"]);
    expect(cell(host).text).toBe("Observer mutation");
  });
  it("counts JSON structure, scalar values and final UTF-8 bytes without charging array index keys", () => {
    const snapshot = (value: unknown, bytes: number) => snapshotReportJson(value, { maxBytes: bytes, error: (_code, message) => new Error(message) });
    expect(snapshot([0, false, null], 14)).toEqual([0, false, null]);
    expect(() => snapshot([0, false, null], 13)).toThrow("字节预算");
    expect(() => snapshot("中文", 4)).toThrow("字节预算");
    expect(() => snapshot({ x: 0 }, 6)).toThrow("字节预算");
    expect(() => snapshot(0, 0)).toThrow("正安全整数");
    expect(snapshot({ x: undefined, y: [undefined] }, 12)).toEqual({ y: [null] });
  });
});
