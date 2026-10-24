# 自动选择导出执行环境

PDF/XLSX 的最终编码可能包含同步排版、字体处理和第三方 ZIP 压缩。`createAutoReportExporter` 在开始编码前选择执行位置：小任务本地运行；达到阈值且隔离环境可用时使用独立 Worker。选中 Worker 的每个任务创建一个隔离实例，成功、失败、取消和超时都会终止并释放实例，旧结果不会交付。

它只编码已准备的计划。业务取数、资产回调、鉴权、二维码生成与字体获取仍由宿主完成；不会在线下载字体、运行宿主函数或创建 Blob/eval 脚本。

## Vue：一个可选配置

```ts
import EncodingWorker from '@agile-team/mach-report/worker/encoding?worker'
import { createReportSource } from '@agile-team/mach-report/vue'

// reports 为应用已有的模板、取数和字段映射注册表。
const fetcher = createReportSource(reports)
const exportExecution = {
  workerFactory: () => new EncodingWorker(),
}
```

```vue
<ReportPreview :fetcher="fetcher" :report-id="reportIds"
  :export-execution="exportExecution" />
```

上述工厂适用于 Vite。应用构建配置需要允许 Worker 的 ES 模块分块：

```ts
export default defineConfig({ worker: { format: 'es' } })
```

Vite 将包内 `worker/encoding` 入口与依赖生成同源资产。CSP 需允许应用自身的 Worker 资源（通常为 `worker-src 'self'`）。不要将包入口通过 `?url` 单独复制，也不要使用未处理的 npm 包名作为 `new URL()` 地址；依赖分块必须由构建器一起处理。其他构建器使用其模块 Worker 工厂，或编写一个调用 `serveReportEncodingWorker()` 的本地入口。

未配置工厂时浏览器仍能导出：小任务本地执行；大任务的决策明确为 `worker-unavailable`、`hardCancellation: false`，不会宣称已隔离。要求强隔离时设置 `mode: 'worker'`，工厂缺失或不支持序列化配置会明确失败。

## 框架无关与 Node

```ts
import { createAutoReportExporter } from '@agile-team/mach-report/worker'
const output = createAutoReportExporter({ workerFactory: () => new EncodingWorker() })
try {
  const file = await output.exportPrepared({ prepared, format: 'xlsx', signal })
  console.log(file.execution) // 实际执行位置、原因、扫描估值、是否可硬取消
} finally {
  output.dispose()
}
```

```ts
import { createNodeAutoReportExporter } from '@agile-team/mach-report/server/node'
const output = createNodeAutoReportExporter() // 自动使用包内 worker_threads 入口；无需另建文件
try {
  const file = await output.exportPrepared({ prepared, format: 'pdf', pdf: fonts, signal })
  // 使用 file.bytes 保存或响应文件。
} finally {
  output.dispose()
}
```

Node 的 ESM/CommonJS 消费均有实际打包测试。自动执行器同时最多接受 2 个任务；超出返回 `queue-full`，避免无界创建线程。需要排队时复用服务端任务队列，不在宿主手工创建无限 Worker。

## 决策、预算与回退

| 配置 | 默认及含义 |
| --- | --- |
| `mode` | `auto`；可显式选 `local` 或 `worker` |
| `thresholds` | 任意达到 20,000 个单元格、20 页或 2,000,000 字节估值即选择隔离 |
| `timeoutMs` | 120,000 ms；可由 `budget.maxDurationMs` 指定 |
| `budget` | 沿用 Runtime 页数、单元格、输出与准备快照预算，传入内置 Worker 继续校验 |
| `fallback` | `local`；仅自动模式缺少工厂或同步构造失败可回退。`error` 要求明确失败 |
| `onDecision` | 只读观察实际选择；同步抛错/异步拒绝不会改变导出结果 |

阈值估算最多扫描 100,000 个节点，并在达到阈值后立即停止；只读文本/图片长度与字体字节长度，不重复哈希内容。`estimate` 为下界，不是完整统计。正式编码仍重新校验计划与预算。

Worker 已经创建并开始消息执行后的错误（含异步加载/CSP错误、序列化、字体、数据校验、编码错误）直接返回，绝不在本地静默重跑。函数选项（例如 Excel `sheetName`）选择本地并标记 `nonserializable-options`；强制 Worker 模式拒绝这些选项。Vue 保留原本地回调路径，序列化选项及图片预算完整传递。

字体传输使用独立快照的 transfer list，绝不 detach 调用方的原始 ArrayBuffer。输出二进制也转移所有权，避免 Worker 返回时再次复制。资源回调应在生成 `prepared` 之前完成。

## 取消与输出一致性

- 隔离任务取消/超时会终止整个 Worker，覆盖第三方最终 ZIP 压缩；Promise 在线程释放后完成。
- 本地任务只支持协作式取消。第三方同步/压缩内部不能强停；需要硬取消的调用必须使用 Worker。
- `cancel()` 取消当前任务，执行器仍可继续用；`dispose()` 取消并关闭，Vue 卸载会自动释放。
- 自定义 PDF exporter 保持宿主原行为。其内部线程或网络资源由自定义实现管理，不冒充包内 Worker。
- `layoutPolicy: 'verify'` 为 Runtime 默认，验证准备时与编码时字体身份。Vue 既有预览可明确选择 `preserve`，保持已有几何，并返回 `prepared-layout-preserved` 说明；已有 font fingerprint 仍须匹配。`preserve` 不降低 `fidelity: 'strict'` 的实际缺字、坏图或输出降级检查。

自动执行不包括把 Provider/数据库连接迁到线程，也不替代分布式任务调度、真实 Office 渲染校验和实体打印验收。
