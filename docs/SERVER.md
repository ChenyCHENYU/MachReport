# 服务端、Worker 与共用契约

MachReport 的模板、参数、字段校验和分页核心不依赖 Vue。`/server` 提供无 HTTP 框架的运行时；`/server/node` 提供 Node 线程隔离；`/worker` 提供浏览器原生 Worker 适配。PDF、Excel 只在调用相应导出时加载，核心入口不会反向加载这些子路径。

实时取数使用 `runtime.export()`；确认结果后固定导出使用 `runtime.exportPrepared()`，已保存实例使用 `generation.exportInstance()`。它们复用同一编码管线。字体身份、Worker 升级、准备快照预算与异步标签分批见[交付指南](DELIVERY.md)。

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

## HTTP 契约与 Java 门面

`createReportOpenApi(runtime.describe(authorizedIds))` 生成 OpenAPI 3.1 文档，描述 `GET /reports`、`POST /reports/{id}/prepare` 与 PDF/XLSX 下载。`reportHttpError(error, correlationId)` 共用参数、预算、取消、超时和过载的状态映射；未知异常统一返回安全文案，保留关联 ID，不发送堆栈或未知异常详情。它们不创建 HTTP 服务，也不替宿主判断授权报表范围。`basePath` 可调整路由前缀，宿主实际注册的路径需保持一致。

HTTP 请求参数使用字符串，精确小数和编号保持 JSON 字符串；OpenAPI 将执行时的类型约束保留在 `x-report-typedSchema`。这与 `describe().paramsSchema` 的 typedValues 描述不同，避免 Java 生成器把运行时需要的字符串错误地替换成数字。

可复制的 [MachReportClient.java](../examples/server-java-node/MachReportClient.java) 为 Java 17 标准库门面，提供 `prepare`、`export` 与受限 `send`。宿主继续使用自己的 Jackson DTO 序列化参数，传入自有 `HttpClient` 接入认证；返回标准 `HttpResponse`，保留错误体、状态码与关联响应头，不隐式重试。实际例子使用该门面并验证 OpenAPI、精确值、错误及下载，不是单独维护的一套伪代码。

```java
var reports = new MachReportClient(URI.create("http://127.0.0.1:8620"));
var response = reports.prepare("sales", mapper.writeValueAsString(params),
    Duration.ofSeconds(30), "request-42");
// 按 response.statusCode() 消费 JSON；导出同样保留 HTTP 状态后再保存 bytes。
```

`mapper` 是宿主已有的 JSON 序列化器。这个参考客户端接收完整响应，内存占用受服务端输出预算约束；超大下载由宿主使用标准 HttpClient 文件/流式 BodyHandler 扩展，不另造 Java 排版引擎。

## 按页文档与渐进预览

需要提前展示已排出的页面或按页持久化时，使用可选的 `ReportDocumentStore`。普通预览和 `runtime.prepare()` 的接入保持不变。

```ts
import {
  createMemoryReportDocumentStore, writeReportDocument, readReportDocumentPages
} from "@agile-team/mach-report/server";
import { RENDER_PLAN_SCHEMA_VERSION, paginateTemplatePages } from "@agile-team/mach-report";

const documents = createMemoryReportDocumentStore();
const manifest = await writeReportDocument(documents, {
  scope: authorizedTenantId, id: "run-42", version: generationId,
  plan: { schemaVersion: RENDER_PLAN_SCHEMA_VERSION },
  pages: paginateTemplatePages(template, datasets), signal
});
const window = await readReportDocumentPages(documents, {
  scope: authorizedTenantId, id: manifest.id, version: manifest.version,
  fromPage: 0, limit: 4, signal
});
// 返回 manifest、pages、nextPage；building 时可从 nextPage 继续读取稍后提交的页。
```

低层 `create → append → complete` 支持生产者与读者并行：append 只追加一页，以 revision 做 CAS；已提交页不会被覆盖，complete 后禁止追加。读取必须指定 version，避免切换查询后混入旧页。`scope` 必须从宿主已认证上下文取得，不能直接信任前端租户参数；version 是不可复用的生成实例身份，删除后再次生成也应换新 version。

默认最多 32 份文档、总计 64 MB、每份 10000 页、单页 4 MB、清单 1 MB。读取默认 4 页/8 MB，单次最多 32 页；满容量显式报错，不偷偷驱逐正在查看的文档。`writeReportDocument` 取消/失败时尝试以 CAS 标记 `failed`（cancelled/generation），保留已提交页并抛出原始错误；存储故障导致失败标记未写入时仍保持 building，由宿主任务状态核对。低层生产者可以显式调用 `fail`。不得将 building/failed 当作完整可交付报表。

等待异步生产者下一页时也响应取消，迟到结果不会追加；生产者应同时使用 signal 关闭自己的数据库/网络资源。可传现有 PreparedReport 的 plan 头与页面，完成时附上 metadata，保存同次查询的统计、来源修订与诊断；metadata 页数须与已提交页一致。删除会清理页面和清单，不保存永久墓碑；宿主须使用不复用的 version，避免删除后复用相同身份造成旧读者歧义。

Node 可用 `openFileReportDocumentStore({ directory, ...budget })`（`/server/node`）：内存只保留有界清单，页面保存在文件中，单页读取，关闭后可重新打开。参考适配器使用目录独占锁和原子 rename；不支持多进程/多实例，不承诺断电事务持久性。异常进程留下锁时，需要宿主确认旧进程已终止后清理锁，再重新打开。文件目录必须为受控私有路径；生产共享存储由宿主实现同一接口、事务/CAS和保留策略。

按页存储解决生成结果的持有与传输，不会将完整数据集自动变成流式查询，也不会改变分组/矩阵计算的数据需求。`paginateTemplatePages` 的输入预算、取消与输出规则仍然适用。

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

问题包含稳定的 `code/path/field/message`；异常为 `ReportParamValidationError`，`code="params"`。参数配置本身非法也会明确报错：JSON/JS 传入非数组、空定义项、非字符串默认值或非法选项时，返回 `definition` 问题，不进入取数和值校验。JSON Schema 采用 Draft 2020-12；日期使用 `format: "date"`，日期上下界保留为 `x-report-minimum/x-report-maximum` 扩展，Java 适配层需要执行这两个日期范围规则。未知参数保留；参数校验不能代替权限或查询字段白名单。

Java 不直接执行 npm 包。可选做法是由已有 Java 后端完成认证、数据查询、事务与保存，再通过 JSON/HTTP 调用 Node 运行时。宿主可按已有规范注册下面的接口，库不会自动创建端口、接口或数据库表：

| 宿主接口职责 | 对应运行时调用 |
| --- | --- |
| 描述已授权报表的参数和字段 | `runtime.describe(authorizedIds)` |
| 校验查询参数 | `runtime.validate(request)` |
| 生成预览计划或快照 | `runtime.prepare(request)` |
| 下载报表文件 | `runtime.export(request)`，返回 `contentType` 和二进制 `bytes` |

`dataSchema` 是可选的严格字段契约，不自动把数字文本转换为数字；缺失数据集、错误字段类型和重复业务键不会被改成空表。数据问题通过 `ReportSourceError("validate")` 的 `cause.issues` 返回；契约配置错误归为 `config`。`decimal` 字段保留十进制文本，适合避免大整数和高精度数值损失。Java 可从 `datasetsSchema` 生成或核对 DTO，再采用相同业务口径。

字段契约还可集中声明 `description`、`unit`、`missingMeaning`、`format`、`aggregation` 和 `calculation: { description, dependsOn }`，JSON Schema 保留 `x-report-*` 扩展，`columnsFromContract()` 自动复用显示格式。`aggregation: "none"` 可表达非可加指标；这些是明确业务语义，不自动为报表增加汇总，也不按描述文本执行公式。计算依赖会校验未声明字段和循环；显示精度仅改变展示，不改原始数据或替代计算舍入口径。

`explainDatasetField(contract, { datasetId, field, rowKey? })` 将显式定义/计算说明转成带业务目标的 diagnostics，可直接放进 Provider 查询结果供预览定位。空值原因必须由业务数据声明 `valueState`，不会从全字段说明推断每个空白的原因。

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

默认运行时预算为 100000 行、10000 页、2000000 个渲染单元格、100000000 输出字节、120000 毫秒，可通过 `budget` 显式调整。数量和字节预算须为正安全整数。分页前检查行数，并按明细行×列、表头和静态网格预检逻辑规模，避免明显的高列数内存放大；页预算在追加超限页前中止，多报表请求共用同一额度，之后再核对实际页面/单元格数。文件字节数在生成后检查；这些限制不是流式处理承诺。`dataValidation` 可收紧字段校验预算，不能绕过运行时的硬预算。

直接调用 `paginateTemplate` 可选传 `{ maxPages, maxCells, maxChartComponents }`，分别抛 `PaginatePageLimitError / PaginateCellLimitError / PaginateChartComponentLimitError`；`createReportSource` 对一次请求合并的全部报表及编辑重算共用预算。页数和网格预算未配置时保留原有行为；图表图元默认 50,000，可设 1..1,000,000，绑定图表在分配图元前预检，不改变 `maxCells` 语义。Runtime 的 `budget.maxChartComponents` 透传该总额度，统一将超限归为 `ReportRuntimeError`，`code="budget"`，路径为 `$.budget.maxPages / maxCells / maxChartComponents`。图表预算仅保护绑定图表展开，已生成计划不按该预算重新识别静态矩形。逐页网格预算包含重复表头、锚点和嵌套网格，大数据可使用[逐页生成](./COMPLEX_REPORTS.md)。

跨重启任务见[持久任务](./DURABLE_JOBS.md)，模板上线前的真实PDF/XLSX校验见[发布验收](./PUBLICATION_REVIEW.md)。两者均通过注入适配器接入，不要求常规预览页面增加配置。

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

使用自定义执行器或 Worker 时，外层与执行端 Runtime 应配置相同的 `budget`。外层可以核对返回结果，执行端的预算才会在取数和分页过程中提前阻止超限；只调小外层额度不能代替执行端的资源保护。

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
const fetcher: ReportFetcher = async ({ reportIds, params, signal, taskId, correlationId, onEvent }) =>
  (await executor.prepare({ reportIds, params, taskId, correlationId }, signal, onEvent)).plan;
```

把 `fetcher` 传给预览组件即可沿用阶段反馈、取消与过期结果保护。Worker 中的 Provider 应使用 Worker 可用的客户端，例如 `fetch`；依赖 DOM 的宿主代码留在主线程。浏览器入口不会导入 `node:worker_threads`。

## 大批量数据 Excel

当目标是连续数据导出时，可直接使用独立的 [`/xlsx/node` 流式适配器](../packages/mach-report/src/xlsx/node.ts)，消费 `AsyncIterable` 并处理背压、进度和取消，无需先生成完整 RenderPlan。它输出数据工作表；PDF 或固定版式继续走运行时布局出口。详细区别见 [Excel 文档](./EXCEL.md)。

权限始终由宿主校验：报表 ID、租户、数据范围、编辑字段、冻结状态、来源修订、幂等请求以及数据库事务，都不由模板、客户端或 Worker 的参数验证代替。

## 阶段事件与关联请求

查询、字段/计划校验、分页排版和文件编码使用同一可选观察契约。普通接入保持原有参数；需要任务反馈时添加 `taskId`、`correlationId` 和 `onEvent`：

```ts
const file = await runtime.export({
  reportIds: ["sales"], params: { plant: "YTS0" }, format: "xlsx",
  taskId: "export-42", correlationId: "request-42", signal,
  onEvent(event) {
    // event.stage: query | validate | layout | encode
    // event.status: started | completed | failed
    // reportId（报表阶段）、completed/total（有明确单位时）均为可选。
    taskStore.update(event);
  }
});
```

`taskId` 未传时由包内生成；同一 Runtime 调用贯穿全部阶段。阶段可以重复，例如多张报表各有 query/validate/layout，最后还会校验合并计划；不要把事件数换算成估算百分比。编码器仅在有准确单位时提供计数，最终文件封装仍可能暂时无法确定进度。

`onEvent` 是同步观察器：异常被隔离，不影响报表结果；不用于校验、授权或事务决策。事件不包含数据行、鉴权或文件内容。取消/超时后不再通知，忽略 signal 的上游即便迟到也不会更新任务。Worker 使用独立事件帧转发并校验任务身份、阶段、计数，不把函数传给 `structuredClone`。自定义 executor 的第三个可选参数接收观察器，原有两个参数实现继续兼容。

阶段耗时可直接在宿主复用事件，不需要接入新的遥测平台。下面每次调用独立分配一个小 Map；`started` 进度帧只在没有起点时记时，避免编码进度把起点反复覆盖。观察器只采集阶段、状态、耗时和受控计数，事件完成后释放对应项，调用结束后统一清理：

```ts
const started = new Map<string, number>();
try {
  await runtime.export({
    ...request, taskId, correlationId, signal, format: "xlsx",
    onEvent(event) {
      const key = JSON.stringify([event.taskId, event.reportId ?? null, event.stage]);
      if (event.status === "started") {
        if (!started.has(key)) started.set(key, performance.now());
        return;
      }
      const from = started.get(key);
      started.delete(key);
      metrics.record({
        stage: event.stage, status: event.status,
        ...(from === undefined ? {} : { durationMs: performance.now() - from })
      });
    }
  });
} catch (error) {
  metrics.record({ stage: "request", status: signal?.aborted ? "cancelled" : "failed" });
  throw error;
} finally {
  started.clear();
}
```

`metrics.record` 是宿主已有的轻量缓冲/计数器，不能在同步回调中执行网络请求或遍历报表。同一阶段的多张报表、重复报表和合并校验会依次出现多轮事件；不将它们当作一次不可重复的阶段。需要全链路关联时可在受控日志中保留 taskId/correlationId；不要把每次请求 ID 当作指标标签，以免高基数占用内存。取消后阶段事件被抑制，所以通过外层 catch/finally 记录请求终态并清理计时，不等待必然出现 failed 帧。

观察范围不得包含数据行、单元格原值、请求参数、sourceToken、字体/文件字节、Authorization或数据库连接信息；不要直接序列化错误对象或异常 cause。错误码与HTTP状态可用 `reportHttpError` 的稳定映射单独统计，未知异常详情仅按宿主受控日志规则处理。事件不是审计事务凭证，也不用于推断任务已落库。

队列可直接转交任务上下文，调用侧无需自己合并生命周期：

```ts
const task = queue.enqueue(
  ({ taskId, signal, onEvent }) => runtime.export({
    reportIds: ["sales"], params: { plant: "YTS0" }, format: "pdf",
    taskId, signal, onEvent, correlationId: "request-42"
  }),
  { id: "export-42", onEvent: event => taskStore.update(event) }
);
// task.status / task.event（最新阶段）/ task.progress / task.cancel()
const result = await task.result;
```

顶层 `fidelity: "strict"` 可让 Runtime 在编码前拒绝已识别的保真度问题，抛 `OutputFidelityError`（`code="output-fidelity"`、`diagnostics`）。默认 `warn` 保留诊断并输出文件。strict 保证已识别的能力边界，不承诺与任意 Excel/Office 渲染逐像素一致；模板、字体和各出口的验收仍需真实样本。

## 可运行的 Java → Node 参考闭环

[标准库参考服务与 Java 客户端](../examples/server-java-node/README.md) 共用 JSON fixture，演示参数 JSON Schema、错误映射、高精度值、超时/取消与二进制下载。`node scripts/check-server-example.mjs` 使用实际打包产物启动临时服务，真实编译 Java 17 目标并执行 HTTP 验证；同时跑 24 次并发查询、8 次并发导出并检查任务槽位释放。

高精度十进制、超安全整数范围和带前导零编号使用 JSON 字符串传输；Java 端按业务契约使用 `BigDecimal`，不要先转换成 `double` 再恢复。Node SDK 不替 Java 执行数据库权限或事务。

## 消费端兼容门禁

`node scripts/check-compat.mjs` 对本机实际 Node/Vue 组合检查打包产物的十三入口、ESM/CJS、Runtime、PDF/XLSX 和 Vue SSR。可传 `--node=/path/to/node --vue=3.2.47`；只为真正执行过的组合输出版本，不把矩阵配置当验证通过。

固定标签的重复、绑定和二维码/条码也可在 Node 执行。创建 Runtime 时传 `assets: { assetRenderers: createCodeAssetRenderers() }`，本地 prepare 和 export 共用真实码图，资源阶段以 `assets` 事件上报。Worker 在其执行器内部配置该适配器，函数不进入序列化请求。编码入口按需加载；详见[工业标签](LABELS.md)。

CI 追加 Node 18/20/22/24 × Vue 3.2.47/3.5 的独立消费矩阵，复用主门禁产出的同一 tarball，不在旧 Node 上运行开发构建链。Firefox/WebKit 运行真实渲染、参数、Excel边框和宽表流程；完整 Chromium 门禁保持零重试。它们的运行结果以 CI 回执为准。

性能回归继续使用原有首屏、DOM窗口与翻页门禁；服务端重复查询/导出报告堆样本，并以队列活动数、排队数和已终止 Worker 等确定性资源释放为门禁。堆曲线需要在固定环境长期采样，单次 GC 波动不能用于承诺无泄漏或修改阈值。

模板库、发布和批量生成的通用连接可以直接使用可选 `createReportWorkflow()`；见[模板到实例接入](./WORKFLOW.md)。跨项目携带模板、字段契约、字体与 Logo 摘要、明确脱敏样例时使用[可搬运模板包](./TEMPLATE_PACKAGE.md)。这些 API 不接管企业账号、数据库连接或调度平台。


## 前后端共享填报规则与数据核对

核心 `validateReportDataset` 与浏览器候选验证共用 `ReportValidationRule/ReportPredicate`，支持跨字段、完整行和显式数据集汇总；`assertReportValidation` 在错误或阻断警告时失败。树来源可显式提供同一tree配置，覆盖所有子节点，汇总按叶节点口径。不要只验证请求中改动的几格而遗漏隐藏行、派生值和总量约束。

```ts
import { validateReportDataset, assertReportValidation } from '@agile-team/mach-report';
// candidateRows/rules 来自宿主已授权的数据及可信规则定义。
const issues = validateReportDataset(candidateRows, { rowKey: 'id', rules, signal });
assertReportValidation(issues); // 通过以后才能进入原子持久化。
```

校验器不连接数据库。宿主仍负责认证、租户和字段白名单、读取完整候选、并发/CAS、幂等、数据库事务及审计。需要会话重算时使用 `prepare(..., { validation })`，在调用业务保存**之前**断言 `prepared.validationIssues`，成功后才 `commit`；commit拒绝不能撤回已发生的外部数据库写入。

`createReportPrefill/reportPrefillInputs` 提供按稳定业务身份的预填审阅与补丁入口；`compareReportData` 提供显式十进制/容差/缺失策略的只读对比。两者不内置业务历史接口、不按行号对应记录，也不授予访问其他来源的权限。复合参数、JSONSchema扩展与显式业务时区的 `reportDateDefault` 同样可以在Node使用。

静态数据条的XLSX输出说明通过 `xlsx-snapshot` 信息诊断保留，`xlsx.maxDataBars` 限制绘图量；静态语义不是缺失内容的warning。详细契约见[数据工作流](DATA_WORKFLOW.md)，企业平台的数据库连接、IAM、调度和渠道仍按[产品路线](PRODUCT_PLATFORM.md)另行实施。
