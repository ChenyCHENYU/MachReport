# 服务端、Worker 与共用契约

MachReport 的模板、参数、字段校验和分页核心不依赖 Vue。`/server` 提供无 HTTP 框架的运行时；`/server/node` 提供 Node 线程隔离；`/worker` 提供浏览器原生 Worker 适配。PDF、Excel 只在调用相应导出时加载，核心入口不会反向加载这些子路径。

## 最小 Node 接入

```ts
import { writeFile } from "node:fs/promises";
import { createProviderReport, createTableTemplate } from "@agile-team/mach-report";
import { createReportRuntime } from "@agile-team/mach-report/server";

const reports = {
  sales: createProviderReport({
    template: createTableTemplate({
      title: "销售明细",
      columns: [{ header: "商品", field: "name" }, { header: "金额", field: "amount" }]
    }),
    params: [{ field: "date", type: "date", required: true }],
    dataSchema: { detail: { fields: [
      { field: "name", type: "text", required: true },
      { field: "amount", type: "number", required: true }
    ] } },
    provider: {
      query: async ({ params, signal }) => ({
        datasets: await salesApi.query(params, { signal }), // 返回 { detail: [...] }
        revision: "业务接口返回的修订号"
      })
    }
  })
};

const runtime = createReportRuntime({ reports });
const request = { reportIds: ["sales"], params: { date: "2026-10-16" } };
const prepared = await runtime.prepare(request);
console.log(prepared.stats, prepared.revisions, prepared.diagnostics);
const file = await runtime.export({ ...request, format: "xlsx" });
await writeFile("sales.xlsx", file.bytes);
```

`salesApi` 是宿主业务客户端，库不规定 URL、鉴权或响应包装。已有 `load`、`defineReport({ load, mapData })`、静态 `datasets` 继续使用；同时配置时 `load` 优先于 `provider.query`。

| 方法 | 结果 |
| --- | --- |
| `describe(ids?)` | 参数元数据、`paramsSchema`、各数据集的 `datasetsSchema`、Provider 可选能力 |
| `validate(request)` | `{ ok, values, typedValues, issues }`，只校验已声明参数，不取数 |
| `prepare(request)` | `{ plan, diagnostics, stats, revisions }`，实际取数、校验与分页 |
| `export(request)` | `{ bytes, format, contentType, diagnostics, stats, revisions }`，支持 PDF/XLSX |

`describe().capabilities.export` 表示 Provider 的远程导出方法是否存在；运行时自身始终提供 PDF/XLSX。`revisions[reportId]` 保存查询返回的 `revision/sourceToken`，不会替后端生成业务修订。

## 参数与 Java 共用

参数的默认值、必填、类型、选项、数字/日期范围、文本长度由同一核心校验。已声明的静态参数在所有业务取数之前校验；动态模板中的参数在模板加载后、业务取数前校验。动态模板应在报表定义上同步声明 `params`，便于查询面板和 `describe/validate` 提前获得约束。

```ts
import { validateReportParams, reportParamsJsonSchema } from "@agile-team/mach-report";

const defs = [
  { field: "date", type: "date" as const, required: true, min: "2026-01-01" },
  { field: "limit", type: "number" as const, defaultValue: "20", min: 1, max: 100 }
];
const result = validateReportParams(defs, { date: "2026-10-16" });
// result.values.limit === "20"：兼容现有前端取数契约
// result.typedValues.limit === 20：与导出的 JSON Schema 对应
const schema = reportParamsJsonSchema(defs);
```

问题包含稳定的 `code/path/field/message`；异常为 `ReportParamValidationError`，`code="params"`。参数配置本身非法也会明确报错。JSON Schema 采用 Draft 2020-12；日期使用 `format: "date"`，日期上下界保留为 `x-report-minimum/x-report-maximum` 扩展，Java 适配层需要执行这两个日期范围规则。未知参数保留；参数校验不能代替权限或查询字段白名单。

Java 不直接执行 npm 包。可选做法是由已有 Java 后端完成认证、数据查询、事务与保存，再通过 JSON/HTTP 调用 Node 运行时。宿主可按已有规范注册下面的接口，库不会自动创建端口、接口或数据库表：

| 宿主接口职责 | 对应运行时调用 |
| --- | --- |
| 描述已授权报表的参数和字段 | `runtime.describe(authorizedIds)` |
| 校验查询参数 | `runtime.validate(request)` |
| 生成预览计划或快照 | `runtime.prepare(request)` |
| 下载报表文件 | `runtime.export(request)`，返回 `contentType` 和二进制 `bytes` |

`dataSchema` 是可选的严格字段契约，不自动把数字文本转换为数字；缺失数据集、错误字段类型和重复业务键不会被改成空表。数据问题通过 `ReportSourceError("validate")` 的 `cause.issues` 返回；契约配置错误归为 `config`。`decimal` 字段保留十进制文本，适合避免大整数和高精度数值损失。Java 可从 `datasetsSchema` 生成或核对 DTO，再采用相同业务口径。

## 字体与输出诊断

PDF 中文需传入有授权的字体字节；运行时不隐式下载字体。可提供 `pdf.customFontBytes` 或 `pdf.customFontFaces` 的 regular/bold/italic/boldItalic。提供字体时，运行时自动用同一字体字节度量分页，并将同一测量器传给 PDF 输出。

```ts
const file = await runtime.export({
  ...request, format: "pdf",
  pdf: { customFontFaces: { regular: await readFont("regular.ttf"), bold: await readFont("bold.ttf") } }
});
```

`readFont` 是宿主受控字体读取方法。缺字体字符、图片不兼容、组件降级等会出现在 `diagnostics`；结构化出口问题含组件路径。`stats` 包含行数、页数、单元格数、执行时长和导出字节数。

## 预算、队列和取消

默认运行时预算为 100000 行、10000 页、2000000 个渲染单元格、100000000 输出字节、120000 毫秒，可通过 `budget` 显式调整。分页前检查行数，并按明细行×列、表头和静态网格预检逻辑规模，避免明显的高列数内存放大；分页后再检查实际页面/单元格数。文件字节数在生成后检查；这些限制不是流式处理承诺。`dataValidation` 可收紧字段校验预算，不能绕过运行时的硬预算。

```ts
import { createReportTaskQueue } from "@agile-team/mach-report/server";

const queue = createReportTaskQueue({ concurrency: 2, maxQueued: 10 });
const task = queue.enqueue(({ signal }) => runtime.export({ ...request, format: "pdf", signal }));
const file = await task.result;
// task.cancel() 发送取消；task.status / task.progress 可用于任务面板。
// 自定义任务可通过上下文 reportProgress(completed, total?) 报告进度。
```

排队任务取消后不会执行；关闭队列拒绝新任务。运行任务只有真正结束后才归还并发槽位。同步分页在阶段边界检查取消，不能在同一线程的同步计算中途抢占；需要硬取消 CPU 工作时使用下面的隔离执行器。任务队列在当前进程内，跨实例的持久化任务、权限和重试策略由宿主实现。

## Node Worker：复制即用的分层

把模板和 Provider 放到宿主 `reports.js` 中并导出 `reports`。Worker 入口单独注册同一运行时，函数和数据库客户端不跨线程传输。

```ts
// report.worker.js（ESM，先按宿主构建流程编译 TS）
import { createReportRuntime } from "@agile-team/mach-report/server";
import { serveNodeReportWorker } from "@agile-team/mach-report/server/node";
import { reports } from "./reports.js";
serveNodeReportWorker(createReportRuntime({ reports }));
```

```ts
// 服务进程
import { createReportRuntime } from "@agile-team/mach-report/server";
import { createNodeReportExecutor } from "@agile-team/mach-report/server/node";
import { reports } from "./reports.js";

const executor = createNodeReportExecutor({ workerUrl: new URL("./report.worker.js", import.meta.url) });
const runtime = createReportRuntime({ reports, executor });
const file = await runtime.export({ reportIds: ["sales"], params: { date: "2026-10-16" }, format: "xlsx" });
```

每个调用创建独立线程；完成、错误、超时、取消都会清理监听并终止线程。RPC 校验协议与任务 ID，过期消息不会覆盖新结果。导出字节通过所有权转移返回，不额外复制整个文件；输入字体不会被转移或失效。`timeoutMs` 可设置执行器超时，`workerOptions` 透传受控的 Node Worker 配置。服务端应结合有界队列使用，避免无限创建线程；进程/容器内存限制仍由部署环境设置。

## 浏览器 Worker

```ts
// report.worker.ts
import { createReportRuntime } from "@agile-team/mach-report/server";
import { serveReportWorker } from "@agile-team/mach-report/worker";
import { reports } from "./reports";
serveReportWorker(createReportRuntime({ reports }));
```

```ts
import { createBrowserReportExecutor } from "@agile-team/mach-report/worker";
import type { ReportFetcher } from "@agile-team/mach-report";

const executor = createBrowserReportExecutor(() =>
  new Worker(new URL("./report.worker.ts", import.meta.url), { type: "module" })
);
const fetcher: ReportFetcher = async ({ reportIds, params, signal }) =>
  (await executor.prepare({ reportIds, params }, signal)).plan;
```

把 `fetcher` 传给预览组件即可沿用取消与过期结果保护。Worker 中的 Provider 应使用 Worker 可用的客户端，例如 `fetch`；依赖 DOM 的宿主代码留在主线程。浏览器入口不会导入 `node:worker_threads`。

## 大批量数据 Excel

当目标是连续数据导出时，可直接使用独立的 [`/xlsx/node` 流式适配器](../packages/mach-report/src/xlsx/node.ts)，消费 `AsyncIterable` 并处理背压、进度和取消，无需先生成完整 RenderPlan。它输出数据工作表；PDF 或固定版式继续走运行时布局出口。详细区别见 [Excel 文档](./EXCEL.md)。

权限始终由宿主校验：报表 ID、租户、数据范围、编辑字段、冻结状态、来源修订、幂等请求以及数据库事务，都不由模板、客户端或 Worker 的参数验证代替。
