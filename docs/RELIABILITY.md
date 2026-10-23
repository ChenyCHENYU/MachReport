# 数据隔离、交互与输出可靠性

## 多报表编辑

`createReportSource` 为每个报表出现位置分配独立 `sourceScope`。同名 `detail`、相同业务键、重复报表 ID 都不会合并编辑历史或修订号。保存回调中的 `edit.source.sourceScope` 为附加身份；服务端仍须按自己的授权范围校验报表、数据集和业务键。

只有两张视图确实展示**同一份业务来源**时，才显式声明共享：

```ts
const reports = {
  daily: { template: dailyTemplate, load, sourceScope: "production" },
  review: { template: reviewTemplate, load, sourceScope: "production" }
};
```

显式共享范围与默认范围有不同命名空间。共享视图必须提供一致的原值，否则事务报冲突；不能借此将不同来源的数据强行覆盖。报表出现范围 `page.meta.reportScope` 始终独立，用于页面和诊断定位。

首次编辑前，包内核对模板与来源对象是否被宿主修改；不可变字符串按值保留，不再逐字符计算指纹。首次提交后使用独立快照与按需复制，后续宿主修改不会污染编辑事务。属性访问器、循环引用、异常原型及过深/超大对象仍被拒绝。纯 JSON 数据是推荐输入。

## 远程参数与关联详情

远程参数只声明 `optionsSource` 和 `dependsOn`，由一个 `loadParamOptions` 接通宿主已有接口。加载、搜索、取消、级联清空及过期响应隔离由组件管理，详见[参数](./PARAMETERS.md)。

关联动作默认关闭。宿主提供允许的动作及一个 `open` 回调；插件不会执行脚本、拼接 URL 或自行导航：

```vue
<script setup lang="ts">
import type { ReportDrillOptions } from "@agile-team/mach-report/vue";

const drill: ReportDrillOptions = {
  actions: [{
    id: "heat-detail", label: "查看炉次实绩",
    target: { datasetId: "detail", field: "heat", roles: ["body"] },
    params: { heat: { from: "value" }, plant: { from: "query", field: "plant" } }
  }],
  async open({ actionId, params, returnState, view, signal }) {
    // 按 actionId 映射自己的详情页；不把 actionId 当作外部 URL。
    // 保留 returnState（查询参数、原单元格/报表范围）和 view（缩放/滚动）。
    await host.openReportDetail({ actionId, params, returnState, view, signal });
  }
};
</script>
<template><ReportPreview report-id="production" :drill="drill" /></template>
```

参数支持固定标量、当前值、业务行键、已查询参数、当前表行的可见字段。真实 `0`、`false` 和前导零保留；缺少/隐藏字段会禁用动作，不从其他报表猜值。动作只在匹配单元格选中后显示，可用键盘激活；有本地草稿时沿用离开保护。替换报表和卸载会取消在途动作，宿主应遵守 `signal`。

返回时用 `resolveReportDrillReturn(plan, returnState)` 按冻结的业务身份重新定位；原行已消失则返回 `null`，不落到替代行。返回上下文不包含来源令牌。无 Vue 的接入可使用核心 `matchReportDrillActions` / `createReportDrillRequest`。`/product.html` 包含原生对话框返回原单元格的可运行示例。

## 输出结果的可信边界

严格 PDF 会在编码后再次检查缺字、缺失字体字面、解码失败等实际诊断。发现已知降级时拒绝返回成功文件；宽松模式返回文件与明确诊断。不能用“文件头正确”替代字体和业务内容验收。

图片在解码前核对 PNG/JPEG 签名与尺寸；限制单图/累计字节、唯一图片数量、单图/累计像素。重复媒体复用检查结果，MIME 大小写不改变行为。预算是资源保护，不是所有渲染器的绝对内存上限。

连续 Excel 按单元格批次和时间片主动让出执行；取消后不交付部分文件。进度与诊断观察者同步抛错、异步拒绝都不改变已经完成的保存或写入结果。实际业务保存、编码、打印资源准备失败仍拒绝，不伪装成功。

## 从旧版本升级

| 原使用方式 | 处理 |
| --- | --- |
| 多报表恰好使用相同数据集/行键 | 默认独立；若过去依赖隐式镜像，显式配置同一 `sourceScope` |
| 严格 PDF 依赖缺字/坏图片仍生成文件 | 部署完整字体和有效资源；或明确选宽松策略并展示诊断 |
| Runtime 通过 `revisions[id]` 审计多次同 ID 查询 | 读取有序 `sources`，保留每次出现的修订与诊断范围；旧映射仅用于单 ID 兼容 |
| 持久任务对接外部落库 | 使用任务上下文的 `attempt`/`executionToken` 做宿主事务围栏，不能只依赖客户端完成状态 |

API 签名快照、覆盖率下限、依赖清单与产物摘要已加入 `pnpm verify`。真实 Office、打印机/扫码枪、项目业务映射仍需使用项目样例验收；参见[质量边界](./QUALITY.md)和[依赖清单](./DEPENDENCIES.md)。
