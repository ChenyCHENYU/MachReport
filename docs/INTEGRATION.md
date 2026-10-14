# 项目接入：把报表编排交给包内

MachReport 的常规使用侧只需要提供三项业务信息：**报表模板、取数函数、必要的字段映射**。分页、计划校验、参数元数据、按 ID 顺序合并、过期请求隔离和预览导出由包内处理。接口路径、权限和数据范围继续由业务系统决定。

## Vue：应用注册一次

```ts
import {
  defineMachReportConfig,
  defineReport,
  machReportPlugin
} from "@agile-team/mach-report/vue";
import "@agile-team/mach-report/vue/style.css";
import { outboundTemplate } from "./reports/outbound";
import { orderApi } from "./api/orders";

app.use(machReportPlugin, {
  reports: {
    outbound: defineReport({
      template: outboundTemplate,
      load: ({ params, signal }) => orderApi.report(params, { signal }),
      mapData: (data) => ({ detail: data.items })
    })
  },
  config: defineMachReportConfig({
    defaults: { pdfFontUrl: "/fonts/report.otf" }
  })
});
```

`orderApi` 为宿主自己的请求客户端，需返回业务数据并消费 `signal` 才能取消真实网络请求。`defineReport()` 推导 `load` 的返回类型供 `mapData` 使用；不会猜测 `response.data`、`result` 或其它后端包装。数据集键 `detail` 对应模板 `.list("detail", ...)`，行字段对应列的 `field`。

页面只需：

```vue
<MachReportPreview
  report-id="outbound"
  :params="{ orderId }"
  height="70vh"
  @error="onReportError"
  @warning="onReportWarning"
/>
```

`report-id` 选择注册的报表定义，业务单据 ID 和查询条件放在 `params`。不需要在页面实现 `paginateTemplate`、校验器或页合并；无需手写组件 ID 分支或重复参数面板定义。

## 接口已返回数据集或使用静态数据

接口本身返回 `{ detail: [...] }` 等数据集时，直接提供 `load`：

```ts
app.use(machReportPlugin, {
  reports: {
    outbound: {
      template: outboundTemplate,
      load: ({ params, signal }) => reportApi(params, { signal })
    },
    sample: {
      template: outboundTemplate,
      datasets: { detail: [{ name: "物料 A", qty: 3 }] }
    }
  }
});
```

`load` 可同步或异步返回数据集；与 `datasets` 同时提供时优先 `load`。每次查询重新调用，不缓存业务数据、不自动重试，也不推断列表分页接口中的完整结果。普通业务数据的运行时字段校验由宿主完成；包内检查数据集容器、行对象以及生成计划的结构。

## 参数面板自动读取模板

模板可用 DSL 或 JSON 声明参数：

```ts
const template = createTemplate()
  .params([{ field: "warehouse", label: "仓库", defaultValue: "ALL" }])
  .page("a4")
  // ...文本与明细
  .build();
```

注册后，组件自动读取 `template.params`，显示查询面板并使用默认值。报表定义上的 `params` 可以替换模板参数；组件 `paramDefs` 拥有最高优先级，传 `[]` 可不采用这些面板定义。`showParams=false` 只隐藏面板，参数定义及其默认值仍生效。查询按钮验证 `required`；实际业务权限和入参约束由接口执行。

多个报表用数组传 ID：`:report-id="['outbound', 'process-card']"`。包内按数组顺序取数并拼接页面，参数定义取有序并集，同名字段使用首个报表的定义；有冲突时显式提供组件 `paramDefs`，不要依赖隐式覆盖。切换报表后面板重置为新报表默认值与宿主参数。

## 父页面控制：一个句柄

```vue
<script setup lang="ts">
import { useMachReport } from "@agile-team/mach-report/vue";

const report = useMachReport();
async function exportExcel() {
  await report.exportAs("xlsx");
}
</script>

<template>
  <button :disabled="!report.ready.value" @click="exportExcel">导出 Excel</button>
  <MachReportPreview :ref="report.ref" report-id="outbound" :params="{ orderId }" />
</template>
```

句柄提供 `reload()`、`print()`、`exportAs()`、`openPdfWindow()`、`gotoPage()` 和 `setParams()`。`ready` 表示组件控制器已挂载，不代表数据加载完成；未挂载调用明确报 `config` 错误。组件未加载有效页面时打印和导出保持空操作。

`reload`、`print`、`exportAs`、`setParams` 可等待；等待表示本次工作结束，生成失败仍通过现有 `error` 事件报告，不能把 Promise 成功完成视为输出成功。`openPdfWindow()` 必须在点击等用户手势中同步调用，以保留浏览器弹窗权限。

原组件 ref 和后代 `useReportPreview()` 继续可用。同一计划的 PDF、XLSX 和 PNG 重复操作共享正在执行的工作；不同输出格式的忙碌状态会正确协调。切换报表和卸载后，过期任务不再触发下载、错误或告警；正在生成的空 PDF 窗口和打印 iframe 会清理。

## 不使用 Vue：同一数据源

```ts
import { createReportSource, defineReport, renderPlan } from "@agile-team/mach-report";

const source = createReportSource({
  outbound: defineReport({
    template: outboundTemplate,
    load: ({ params, signal }) => orderApi.report(params, { signal }),
    mapData: (data) => ({ detail: data.items })
  })
});
const controller = new AbortController();
const plan = await source({
  reportIds: ["outbound"],
  params: { orderId: "SO-001" },
  signal: controller.signal,
  onWarning: (message) => console.warn(message)
});
document.querySelector("#report")!.replaceChildren(renderPlan(plan, document));
```

`createReportSource` 不依赖 Vue，可在其他前端框架或 Node.js 中用于取数与排版。DOM 渲染需要浏览器；Node.js 可以将得到的计划交给 `/pdf` 或 `/xlsx`。直接使用数据源时，宿主负责 UI、调用取消、输入参数默认值及资源生命周期。

## 高级接入与兼容

| 使用场景 | 入口 |
| --- | --- |
| 常规 Vue 项目 | `app.use(machReportPlugin, { reports })` |
| 页面独立的数据源 | `createReportSource(reports)`，传给组件 `fetcher` |
| 原生 JS / TS、React、Node.js | 核心 `createReportSource` 与渲染 / 导出 API |
| 后端已经返回 RenderPlan | 自定义 `PlanFetcher` |
| 旧离线 / 本地用法 | `createLocalFetcher`，继续支持且能提供模板参数元数据 |
| 首屏按需全局注册 | `/vue/async`，同一插件配置与注册语义 |

优先级为组件 `fetcher` → 插件显式 `fetcher` → 插件 `reports`。同时配置后两者时显式 fetcher 优先，reports 不参与取数。两个 Vue 应用的数据源和配置互不共享。

旧 `PlanFetcher({ reportIds, params }) → Promise<RenderPlan>` 无需修改；新增 `signal`、`onWarning` 和 `getParamDefs` 均可选。新查询及卸载会取消旧信号，旧函数忽略信号时仍由代际检查防止结果覆盖。数据源可以及时结束取消的调用，真实 HTTP 取消需要请求客户端消费该信号；同步分页无法在执行中途被抢占。

配置支持字段继承：应用 defaults → preset → 路由叠加 → 组件 props。`messages`、`theme` 和同名 preset 保留未覆盖字段。普通及异步插件均遵守 `globalComponent=false`，不会覆盖宿主已注册的同名组件。

PDF、XLSX、SQL 实现继续在独立子入口；`/vue` 重导出核心能力不会加载这些重依赖。异步插件的 `reports` 注册阶段不取数，首次查询才加载数据源实现。中文 PDF 字体需要由项目部署完整字库，示例子集仅供示例使用。
