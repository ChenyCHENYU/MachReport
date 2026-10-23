# 同结果导出、标签拼版与分批交付

`/server` 的准备、编码、实例和批量外观可在浏览器与 Node 共用。业务接口、存储键授权和持久化仍由宿主提供；SDK 不内置数据库、账号或 HTTP 框架。

## 导出用户已经确认的结果

`runtime.export()` 保持实时取数语义。需要预览、确认、下载使用同一份数据时，只准备一次，随后调用 `exportPrepared()`。

```ts
import { createReportRuntime } from "@agile-team/mach-report/server";

const runtime = createReportRuntime({ reports }); // reports 为宿主注册的模板和数据来源
const pdf = { customFontBytes: licensedFontBytes };
const prepared = await runtime.prepare({
  reportIds: ["production"], params: { date: "2026-10-23" }, pdf, signal
});

// 将 prepared.plan 交给预览；确认后编码这一份计划，不再次查询或分页。
const file = await runtime.exportPrepared({
  prepared, format: "pdf", pdf, fidelity: "strict", signal
});
await saveArtifact(file.bytes, file.contentType);
```

`exportPrepared()` 在首次异步等待前复制有界 JSON 快照；调用后修改原预览计划不会改变正在编码的文件。它会重新校验计划、实际页面与单元格数、来源行数统计、输出字节和总耗时，并复用配置的图片、二维码、条码资源处理。任务事件包含校验、资源和编码，不出现取数或重新排版。

准备与 PDF 导出应传入相同的字体字节及字重组合。`PreparedReport.layout` 保存字体 SHA256 度量身份，跨 JSON/Worker 仍可校验。字体不匹配或旧计划没有可确认的度量身份时，默认加入 `prepared-font-metrics` 诊断；`fidelity: "strict"` 拒绝该次 PDF 编码。SDK 不通过重新查询或悄悄重排消除差异。无自定义字体、使用默认启发式度量的计划保持原有兼容行为。

默认预算：10 万来源行、1 万页、200 万单元格、100 MB 输出、64 MB 准备结果快照、120 秒。准备结果同时限制 100 万 JSON 节点和 64 层深度；拒绝访问器、危险键、循环和非 JSON 值。单份字体上限 32 MB。可用 `budget` 调整公开预算；硬上限用于避免不受控的内存分配。

```ts
const runtime = createReportRuntime({
  reports,
  budget: { maxPages: 500, maxOutputBytes: 20_000_000, maxPreparedBytes: 16_000_000 }
});
```

## 保存实例后再导出

已有实例服务增加 `exportInstance()`，读取指定的不可变实例修订，随后走相同的 `exportPrepared()` 路径。

```ts
import { createReportGenerationService } from "@agile-team/mach-report/server";

const generation = createReportGenerationService({
  runtime, instances: instanceStore,
  templateRevisions: { production: "published-v8" },
  pdf // 固定的字体字节也用于生成实例时的排版
});

const instance = await generation.generate({
  scope: "plant-a", id: "daily-20261023", title: "生产日报",
  reportIds: ["production"], params: { date: "2026-10-23" },
  expectedRevision: null, signal
});

const file = await generation.exportInstance({
  scope: instance.scope, id: instance.id, revision: instance.revision,
  format: "pdf", pdf, fidelity: "strict", signal
});
```

服务创建时会复制固定的 `pdf` 字体配置；后续调用方修改原字体字节不会影响该服务。`generate()` 与未传 `pdf` 的 `exportInstance()` 共用这份字体快照；需要覆盖时可在单次导出显式提供。实例导出的格式、PDF/Excel 选项、任务监控与取消信号也在读取存储前捕获，等待存储期间的界面选项变化不改变在途任务。

新实例保存 `output` 元数据：来源统计、诊断和字体度量。来源修订保存在 `sourceRevisions`，临时 `sourceToken` 不自动归档到实例。旧实例的 `plan` 仍可导出，但未记录的来源行数明确报告为未知（统计值为 0，并附诊断），页数和单元格数按保存计划重新校验。旧实例未保存字体度量时，PDF 严格模式需要宿主重新生成有度量身份的新修订；普通模式会明确警告。

实例读写必须在宿主完成范围和权限校验后调用；实例快照和字体指纹不替代业务权限、数字签名或数据来源认证。不可变历史修订和 CAS 要求见 [服务端说明](./SERVER.md)。

## Worker 边界

浏览器 `createBrowserReportExecutor()` 和 Node `createNodeReportExecutor()` 均支持 `exportPrepared`。准备结果和字体字节是可序列化输入；资源渲染回调配置在 Worker 内部的运行时，函数不跨线程传输。文件输出仍转移 `ArrayBuffer` 所有权。

```ts
const runtime = createReportRuntime({ reports, executor });
const prepared = await runtime.prepare({ reportIds: ["production"], pdf, signal });
const file = await runtime.exportPrepared({ prepared, format: "pdf", pdf, signal });
```

升级时应同时升级 Worker 入口。旧自定义 `ReportRuntimeExecutor` 可以暂不实现可选的 `exportPrepared()`；调用时会明确报“不支持”，不会退回主线程。同步 CPU 排版在阶段边界响应取消；需要硬终止时使用隔离 Worker。外部归档器应遵守信号及既有任务 attempt/租约围栏；已经提交的文件不能通过取消回滚。

## 标签尺寸与整张纸拼版

标签模板继续声明标签本身的尺寸。`imposeLabelSheets()` 将已经准备好的等尺寸固定页面按行排列到整张纸上，不重新绑定数据、不缩放标签、不改变记录 → 份数 → 版面的原顺序。

```ts
import { imposeLabelSheets } from "@agile-team/mach-report";

const sheetPlan = imposeLabelSheets(prepared.plan, {
  paper: "a4", columns: 2, rows: 4,
  marginMm: 5, gapMm: 2,
  startSlot: 2,                 // 首张纸前两个位置留空；后续纸张从位置 0 开始
  offsetMm: { x: 0.5, y: 0 },  // 打印机校准，单位 mm
  maxSheets: 500, maxComponents: 100_000, signal
});
const file = await runtime.exportPrepared({
  prepared: { ...prepared, plan: sheetPlan }, format: "pdf", pdf, signal
});
```

也支持显式 `{ widthMm, heightMm }` 纸张、四边独立边距与水平/垂直独立间距。标签、边距、间距或偏移超出物理纸张时直接报错；每张纸最多 1000 个位置，默认最多 1 万张纸和 25 万布局项（含网格槽位及嵌套组件），在分配输出前预检。空计划输出空计划，起始空位不会单独生成空白纸。

输出保留独立的有界 JSON 快照，修改输出中的嵌套样式、网格或来源元数据不会修改原标签计划。`maxSnapshotBytes` 默认为 64 MB，另限制 100 万 JSON 节点、64 层深度；非 JSON 元数据或超预算会拒绝。

每个输出页面的 `meta.labelSheet.slots` 保留源页面索引、原页面元数据和物理位置；每个顶层组件的 `meta.labelSheet` 对应相同来源，便于定位记录、份数和版面。该工具不自动重新排列双面正反面；硬件双面顺序、卷纸进纸和设备打印完成回执由宿主及驱动处理。

## 固定标签按块生成与归档

`runLabelStream()` 接受 `AsyncIterable`。包内只保留当前块的声明字段和有界小回执；准备、资源、编码预算复用运行时。`context.export()` 直接编码当前块，使用相同字体、资源、取消信号和预算，接入端无需再建立运行时。

```ts
import { createCodeAssetRenderers } from "@agile-team/mach-report/codes";
import { runLabelStream } from "@agile-team/mach-report/server";

const manifest = await runLabelStream(materialRows(), {
  template: labelTemplate, batchSize: 100, maxRows: 100_000, maxChunks: 1000,
  pdf, signal,
  runtime: {
    assets: { assetRenderers: createCodeAssetRenderers() },
    budget: { maxPages: 1000, maxOutputBytes: 20_000_000, maxDurationMs: 120_000 }
  },
  execute: async (_prepared, context) => {
    const file = await context.export({ format: "pdf", fidelity: "strict" });
    const key = await archive(file.bytes, { signal: context.signal });
    return { key, format: file.format, bytes: file.bytes.byteLength };
  },
  onReceipt: (receipt, context) => appendManifest({ ...receipt, index: context.index })
});
```

每次 `execute` 和 `onReceipt` 完成后才拉取下一块，实现背压；内部复用已有 `runReportBatch`，没有新增持久队列。生成器反复复用同一个行对象也会按次快照；只读取模板声明的标量绑定、主键和份数字段，保持零值、布尔值和编号前导零。声明了 `repeat.rowKey` 时检查整个消费范围内的重复主键，而不只检查当前块。

默认每块 100 条，最大 1000；总行数默认 10 万、最大 100 万；清单默认最多 1000 块、最大 1 万块。当前块声明字段与全局去重主键还受 `maxRetainedBytes` 约束（默认 16 MB，最大 64 MB，按 UTF-16 字符与字段开销保守计数）；这不是 JavaScript 进程总堆上限，编码器和字体另有资源预算。总耗时取 `runtime.budget.maxDurationMs`（默认 120 秒）；每块还独立遵守运行时预算。取数、回执等待和来源清理都响应总超时与取消；外部 Promise 忽略取消时不会继续拉取下一块。错误立即停止后续消费并尝试关闭来源，已归档块保持提交状态。`onReceipt` 应增量持久化小回执，以便后续块失败时仍能核对已完成文件；它不是隔离的遥测回调，失败会停止任务。

这是固定标签的分批交付，不承诺任意列表、矩阵、跨块总计或跨块排序可以流式计算；需要这些结果时先在来源侧完成查询与聚合。`execute` 内的外部归档必须自行校验存储权限、幂等性与信号。归档忽略信号并悬挂时，运行器仍在总超时/取消后释放当前执行等待并尝试关闭来源，不启动后续块。同一轮任务中已经成功返回的回执优先按提交成功处理；归档在取消之后才迟到成功时，SDK 只再次尝试交付该块的小回执，`context.signal.aborted` 为 `true`。因此 `onReceipt` 也可能在总 Promise 拒绝之后调用，宿主应依据既有 attempt/租约围栏记录已提交产物并核对，不能据此重新打开已取消的任务。JavaScript Promise 无法强制中断外部归档；需要强终止时由宿主使用隔离执行器或可取消的服务。一个块一个独立文件，SDK 不把所有文件字节留在内存，也不隐式合并为一个 PDF 或归档包。

## 准备结果的来源身份

Runtime 在加载字体或执行器之前复制 `reportIds` 与 `params`，调用之后修改筛选对象不会改变这次准备或 PDF 导出的口径。Prepared 结果的可选 `sources` 按查询出现顺序记录 `reportId/reportIndex/reportScope/revision/sourceToken`，重复报表 ID 不会丢失前一份来源修订。兼容字段 `revisions` 仍按 ID 保留最后值，精确追溯应使用 `sources`。

业务诊断的 `target.reportScope` 与页面出现范围一致；`tableId` 在合并时按报表序号加命名空间。实例归档保留各来源修订，显式剔除临时 `sourceToken`。旧实例没有 `sources` 仍可读取。`reportScope` 表示本次报表出现位置；编辑数据的显式共享 `sourceScope` 是另一种身份，不能互相代替。

## 任务产物提交围栏

持久任务 handler 的 context 新增只读 `attempt` 与 `executionToken`。每次租约接管/重试都会生成新代次；token 是 `[scope, taskId, attempt]` 的不透明标识，不是鉴权凭证。

```ts
async function handler(payload, context) {
  const artifact = await generate(payload, { signal: context.signal });
  // 宿主适配器必须在同一事务/CAS中核对任务当前attempt，再提交产物引用。
  return artifacts.commitIfCurrent({
    scope: context.scope,
    taskId: context.taskId,
    attempt: context.attempt,
    executionToken: context.executionToken,
    signal: context.signal,
    artifact,
  });
}
```

`artifacts.commitIfCurrent` 是宿主实现的存储边界；先查询再无条件写入不能提供原子围栏。SDK 仍保证过期 attempt 不写回任务成功状态；外部存储也应拒绝过期代次，取消已提交的文件不会被 SDK 假装回滚。
