# 多组参数批量生成

同一模板按多组参数生成，与把多个报表页面合并预览是两种能力。`ReportBatchPanel` 提供紧凑的参数组、状态筛选、复制、删除、逐行校验、进度、回执、取消后继续和显式失败重试；后台实际生成与归档仍由接入方的同一个 `execute` 入口处理。

## 最小接入

```vue
<script setup lang="ts">
import { ReportBatchPanel } from '@agile-team/mach-report/designer';

const paramDefs = [
  { field: 'month', label: '月份', type: 'month' as const, required: true },
];
const initialCases = [
  { id: 'september', params: { month: '2026-09' } },
  { id: 'october', params: { month: '2026-10' } },
];
const execute = async (item, { signal }) => {
  // 与单份报表生成复用同一个受控服务；应在返回成功前完成归档。
  const saved = await reportService.generate({
    templateId: 'production',
    params: item.params,
    requestId: item.id,
  }, { signal });
  return { instanceId: saved.id, label: saved.name };
};
const open = ({ instanceId }) => router.push({ name: 'ReportInstance', params: { id: instanceId } });
</script>

<template>
  <ReportBatchPanel
    :param-defs="paramDefs"
    :initial-cases="initialCases"
    :execute="execute"
    @open-instance="open"
  />
</template>
```

以上业务服务与路由是宿主示意，不是 SDK 内置接口。`requestId` 的生成与幂等作用域需要结合模板、参数和业务生成意图定义，不能把示例行 ID 当作跨页面、跨用户的全局幂等键。

## 操作与状态

- 参数控件复用预览的同一实现，支持文本、数字、日期、月份、年份、日期范围和静态下拉；默认值和边界也由共享校验器执行。
- “生成待处理”只执行待生成与取消的参数组；取消后主按钮显示“继续未完成”。已有成功回执保留，失败组由“仅重试失败项”单独重试。状态筛选只影响浏览，不改变这两个按钮的执行范围。
- 执行前校验本次所有选中参数组；任何一组无效时，整批不启动，自动切回“全部”，跳到真实错误组所在页并聚焦首个错误输入。半个日期范围会定位缺少的日期端点。
- 新增或复制产生独立参数字典和唯一行 ID；修改副本不会改变原行或 `initialCases`。已完成参数锁定；使用“复制为新任务”可保留原结果并重新生成新的实例，避免误覆盖成功回执。
- 失败或取消的参数组修改后会获得新的行 ID，表示新的生成意图；未修改的继续或失败重试保留原行 ID，以便宿主实现同内容幂等。移除后再新增也不会复用本会话已分配的 ID。
- 默认同时执行 2 组，最多 100 组。可选 `concurrency` 为 1–16，`maxCases` 为 1–1000；不会为每行启动不受控并发。
- 状态栏显示全部、待生成、已完成、失败和取消数量，执行期间还可筛选正在生成；每页只挂载当前筛选结果的 10 行，避免同时创建上千套控件。“下一失败项”循环定位失败组、切换失败筛选和页码并聚焦对应组，原始组编号不会被筛选重排。
- 运行时锁定参数输入、增删和复制，保留单行运行、成功、失败、取消状态。某行失败时，其他行继续执行。
- “仅重试失败项”只重新执行失败行，保留已有成功回执。不会自动重试，也不会把已成功的归档再次发送。
- “取消剩余任务”停止后续分配并传递 `AbortSignal`。正在执行的宿主服务应响应信号；若它忽略信号，面板保持“正在取消”直到返回。已经成功完成的生成仍保留为成功，不将其误报为取消。
- 参数定义或执行配置在运行期间被替换时，请求取消当前批次；回调使用该次运行的快照，避免把不同服务混入同一批。
- 卸载时请求取消；过期完成不会再更新卸载后的组件。

`initialCases` 仅用于初始化本地编辑会话。若需替换整份批次，可以由宿主使用稳定批次 ID 作为组件 `key`，并先处理自己的离开保护。该面板不自动离开页面或弹出额外确认框。

## 回执与实例

`execute` 的返回值只保留 `{ instanceId?, label? }`：实例标识最多 512 个字符，标签最多保留 512 个字符；额外载荷、文件字节和业务响应不留在面板。没有可用实例标识时，仍显示执行已完成，但不显示“打开报表实例”。`open-instance` 仅携带回执，由接入方决定路由。

面板内存回执不是持久报表档案。刷新、离开或重建组件后不会恢复这份回执。需要可恢复任务、实例修订、审计或下载授权时，由平台持久化服务承接，不向浏览器塞入整批大文件。

## 无界面与服务端执行

`runReportBatch` 位于轻量 `/server` 入口，浏览器和 Node 可共用。它执行前快照参数、检查唯一安全行 ID、限制批次数量和并发，按输入顺序返回结果；不会修改调用方传入的参数。

```ts
import { runReportBatch } from '@agile-team/mach-report/server';

const outcomes = await runReportBatch(cases, execute, {
  concurrency: 2,
  maxCases: 100,
  signal,
  failure: 'continue',
  onProgress: ({ completed, total, failed, cancelled }) => {
    // 小型进度观察；不要在此重复执行生成或保存。
  },
});
```

执行器上下文的 `index` 是本次输入中的位置，重试子集会重新编号；稳定业务身份使用 `item.id`。`failure: 'stop'` 停止分配尚未启动的行，已运行的行继续完成。执行器应先完成持久化或输出，再返回小型回执；失败与取消不会回滚已经完成的其他行。

共享运行器只约束批次、参数形状和执行生命周期。参数的业务类型、默认值和范围应在调用前用 `validateReportParams` 校验；`ReportBatchPanel` 已内置这一步。HTTP 权限、数据连接、归档服务、持久队列、分发和调度由平台负责，不能通过前端批次状态替代。
