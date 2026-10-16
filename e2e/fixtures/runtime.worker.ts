import { createTemplate } from "../../packages/mach-report/src/builder/template-builder";
import { createReportRuntime } from "../../packages/mach-report/src/server/runtime";
import { serveReportWorker } from "../../packages/mach-report/src/worker/index";

const template = createTemplate().params([{ field: "plant", required: true }]).page(100, 80)
  .list("rows", { leftMm: 0, topMm: 10, widthMm: 80 }, [{ field: "id", header: "ID", widthMm: 80 }]).build();
const runtime = createReportRuntime({ reports: { sales: { template, provider: { query: ({ params }) => {
  if (params.mode === "cpu") {
    postMessage({ qa: "cpu-started" });
    const until = Date.now() + 10_000;
    while (Date.now() < until) { /* CPU workload is intentionally synchronous inside the isolated worker. */ }
  }
  return { datasets: { rows: [{ id: params.plant }] }, revision: "browser-r1" };
} } } } });
serveReportWorker(runtime);
