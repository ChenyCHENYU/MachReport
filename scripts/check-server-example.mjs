import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(resolve(tmpdir(), "mach-report-java-"));
let server;
function run(command, args, cwd = scratch) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command}: ${result.error ?? ""}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  return result.stdout.trim();
}
try {
  if (!process.argv[2]) run("pnpm", ["--filter", "@agile-team/mach-report", "pack", "--pack-destination", scratch], root);
  const archive = process.argv[2] ? resolve(process.argv[2]) : resolve(scratch, readdirSync(scratch).find((name) => name.endsWith(".tgz")) ?? "missing.tgz");
  run("tar", ["-xzf", archive]);
  mkdirSync(resolve(scratch, "node_modules/@agile-team"), { recursive: true });
  symlinkSync(resolve(scratch, "package"), resolve(scratch, "node_modules/@agile-team/mach-report"), "dir");
  cpSync(resolve(root, "examples/server-java-node"), resolve(scratch, "example"), { recursive: true });
  const port = await new Promise((yes, no) => {
    server = spawn(process.execPath, ["--input-type=module", "-e", "import {createExampleServer} from './example/server.mjs'; const server=createExampleServer(); server.listen(0,'127.0.0.1',()=>console.log(server.address().port));"], { cwd: scratch, stdio: ["ignore", "pipe", "pipe"] });
    let error = ""; let output = "";
    const timer = setTimeout(() => no(new Error(`Reference server did not start: ${error}`)), 15_000);
    server.stderr.on("data", (chunk) => { error += chunk; });
    server.stdout.on("data", (chunk) => { output += chunk; if (/^\d+\n/.test(output)) { clearTimeout(timer); yes(Number(output.trim())); } });
    server.on("exit", (code) => { clearTimeout(timer); if (!output) no(new Error(`Reference server exited ${code}: ${error}`)); });
    server.on("error", (cause) => { clearTimeout(timer); no(cause); });
  });
  run("javac", ["--release", "17", "-d", scratch, resolve(scratch, "example/MachReportClient.java"), resolve(scratch, "example/ReportClient.java")]);
  console.log(run("java", ["-cp", scratch, "ReportClient", `http://127.0.0.1:${port}`, resolve(scratch, "example/fixtures"), resolve(scratch, "downloads")]));
  // 重复并发请求后资源门禁检查确定性的槽位归零；堆大小只报告，不依赖GC时机判定泄漏。
  const base = `http://127.0.0.1:${port}`;
  const heaps = [];
  for (let batch = 0; batch < 6; batch++) {
    const queries = Array.from({ length: 4 }, async () => {
      const response = await fetch(`${base}/reports/sample/prepare`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ params: { plant: "YTS0", reportDate: "2026-10-15", delayMs: "5" } }) });
      if (response.status !== 200) throw new Error(`Concurrent request failed: ${await response.text()}`);
      await response.arrayBuffer();
    });
    const exports = (batch < 4 ? ["pdf", "xlsx"] : []).map(async (format) => {
      const response = await fetch(`${base}/reports/sample/export/${format}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ params: { plant: "YTS0", reportDate: "2026-10-15" } }) });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (response.status !== 200 || (format === "pdf" ? new TextDecoder().decode(bytes.slice(0, 4)) !== "%PDF" : bytes[0] !== 0x50)) throw new Error(`Concurrent ${format} export failed (${response.status}): ${new TextDecoder().decode(bytes.slice(0, 400))}`);
    });
    await Promise.all([...queries, ...exports]);
    heaps.push((await (await fetch(`${base}/health`)).json()).heapUsedBytes);
  }
  // 正常批次最多6项，与2运行+4排队一致；另外超载8项验证结构化429，而非放宽队列上限。
  const overload = await Promise.all(Array.from({ length: 8 }, async () => {
    const response = await fetch(`${base}/reports/sample/prepare`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ params: { plant: "YTS0", reportDate: "2026-10-15", delayMs: "200" } }) });
    const body = await response.json();
    if (response.status === 429 && body.error?.code === "queue-full") return "rejected";
    if (response.status === 200 && body.plan?.pages?.length) return "accepted";
    throw new Error(`Unexpected overload response (${response.status}): ${JSON.stringify(body)}`);
  }));
  const overloadRejected = overload.filter((result) => result === "rejected").length;
  if (overloadRejected === 0 || overloadRejected === overload.length) throw new Error("Missing accepted work or explicit queue backpressure");
  await delay(20);
  const health = await (await fetch(`${base}/health`)).json();
  if (health.active !== 0 || health.pending !== 0) throw new Error(`Leaked task slots: ${JSON.stringify(health)}`);
  console.log(JSON.stringify({ concurrentRequests: 24, concurrentExports: 8, peakAcceptedBatch: 6, overloadRequests: 8, overloadRejected, taskSlotsReleased: true, serverHeapSamplesBytes: heaps, memoryPolicy: "informational; no GC-dependent pass/fail threshold" }));
} finally {
  if (server && server.exitCode === null && server.signalCode === null) { const exited = new Promise((yes) => server.once("exit", yes)); server.kill(); await exited; }
  rmSync(scratch, { recursive: true, force: true });
}
