# 大报表按页预览

普通报表继续用 `ReportPreview` 与现有 `PlanFetcher`，不必改接入。后端已经按页保存完整文档时，可选用 `ReportDocumentPreview`：界面只持有当前页和有界缓存，页码、键盘跳转和完整导出仍以同一文档版本为准。

```vue
<script setup lang="ts">
import { ReportDocumentPreview, type ReportDocumentSource } from '@agile-team/mach-report/vue'

// api 是宿主已有的鉴权、取消和二进制下载适配器。
const source: ReportDocumentSource = {
  load: input => api.readDocumentWindow(input),
  export: input => api.exportCompleteDocument(input)
}
</script>

<template><ReportDocumentPreview :source="source" height="100%" /></template>
```

`load({ version?, fromPage, limit, signal })` 返回 `{ manifest, pages, nextPage }`，页偏移从0开始。首次打开/明确刷新不传版本，之后请求钉住首个成功结果的 `scope/id/version`。`manifest` 沿用后端文档存储契约，必须携带状态、修订、总页数和不含 `pages` 的计划头；每个 `pages` 元素都是完整 `PlanPage`。

已有后端存储可直接绑定，HTTP层只转发经过授权的文档窗口：

```ts
import { createReportDocumentSource } from '@agile-team/mach-report/server'

const source = createReportDocumentSource(store, { scope: authorizedTenant, id }, {
  export: input => exportPinnedCompleteDocument(input)
})
const window = await source.load({ fromPage: 0, limit: 3, signal })
```

作用域、账号权限、路由和字体仍由宿主负责。不要直接接受浏览器传来的租户身份，不能把示例内存存储当作分布式数据库。

| 行为 | 约束 |
| --- | --- |
| 窗口和缓存 | 每次最多请求3页、8MB；最多缓存7页、16MB，LRU淘汰。以上按JSON字节计量，不等同进程堆大小；清单另有1MB边界，文档页数最多100000 |
| 加载与取消 | 新跳转替换旧请求；忽略signal的迟到响应不能提交。共享读请求按订阅者管理取消，卸载清理缓存及在途读取 |
| 版本变化 | 切换版本/身份、修订回退或终态变化会拒绝；明确刷新后重新打开。失败保留上次成功页面及页码 |
| 生成状态 | building只展示已提交页及刷新入口；failed仍可检查已提交页。两种状态均不提供完整导出 |
| 完整导出 | 可选 `export({version,format,signal})` 返回标准 `ReportRuntimeExportResult`，仅PDF/XLSX；检查格式、MIME、统计和完整页数。没有该回调或尚无页面时不显示出口 |
| 当前页交互 | 只读，不提供局部计划的编辑/导入/打印/完整搜索，避免把单页当作整个报表；缩放与底部全局页码沿用原预览 |

完整文件在后端编码，返回的 `stats.pages` 必须等于清单的完整页数。宿主必须确保导出使用请求的不可变版本；页数相等不能代替服务器上的版本校验。组件不会为了下载而先把全部页加载到浏览器，也不会把局部计划交给普通预览的默认导出。

实例暴露 `gotoPage(一基页码)`、`reload()`、`cancel()`、`export('pdf'|'xlsx')` 和只读 `state`。`export()` 返回验证后的结果，界面菜单负责下载。`loaded` 回传清单副本，`error` 回传可展示的错误，`exported` 回传完整输出。文案复用 `messages` 和配置中心，可覆盖 `documentBuilding/documentComplete/documentFailed/documentRefresh/documentLoading/documentCancel/documentFullExport`。

这减少传输与前端计划常驻量。输入获取、聚合、矩阵和最终文件编码仍受各自预算约束，不代表后端可以无界输入或无限制生成。
