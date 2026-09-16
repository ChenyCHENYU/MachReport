# MachReport API 速查

> 面向接入方的一页纸。完整类型见各包 `src/`。

## @mach-report/vue — 业务接入（最常用）

```vue
<script setup lang="ts">
import ReportPreview from "@mach-report/vue";
import { createLocalFetcher, createJh4jGridPlanFetcher } from "@mach-report/vue";

// 方式 A：本地模板 + 数据（离线/单测/无后端）
const fetcher = createLocalFetcher({
  T1: { tempId: "T1", template, datasets: { detail: rows } }
});

// 方式 B：消费 jh4j gridPlan（切流期零改动）
const fetcher2 = createJh4jGridPlanFetcher({
  request: (cfg) => platformRequest(cfg)  // 注入平台 request 实例
});
</script>

<template>
  <ReportPreview temp-id="T1" :params="{ id }" :fetcher="fetcher" height="calc(100vh - 206px)"
    @loaded="onLoaded" @error="onError" ref="previewRef" />
</template>
```

| props | 类型/默认 | 说明 |
|---|---|---|
| temp-id | string \| string[] | 逗号串/数组 = 多模板按序拼接 |
| furniture-temp-id | string | 公共页眉页脚模板 |
| params | Record | 报表参数（键名区分大小写） |
| height | "100vh" | 弹窗内建议 calc(100vh - 280px) |
| auto-load / show-export / show-print / show-pdf-window | true | 显隐控制 |
| fetcher | PlanFetcher \| null | 数据面（不传则报错提示） |

emits：`loaded(pageCount)` / `error(message)`；ref：`reload / print / exportAs(format) / openPdfWindow / gotoPage(n)`

## @mach-report/core — 引擎

```ts
import { paginateTemplate, renderPlan, computePageWindow,
         validateRenderPlan, importJh4jTemplateContent } from "@mach-report/core";

const { plan, warnings } = paginateTemplate(template, datasets);   // 模板+数据 → RenderPlan
validateRenderPlan(plan);            // { ok, errors[], warnings[] } JSON path 定位
const el = renderPlan(plan, document);  // RenderPlan → DOM（框架无关）
computePageWindow({ pageHeightsPx, viewportHeightPx, scrollTopPx }); // 虚拟化窗口
importJh4jTemplateContent(content);  // jh4j 模板 content → { template, warnings }
```

Template 模型：`pages[].components[]`，静态组件（text/rect/line/ellipse/image...）+ 列表组件（`kind:"list"`，dataset 引用 + columns 列定义，自动跨页/表头重复）。

### 模板构建器 DSL（推荐替代手写 JSON）

```ts
import { createTemplate } from "@mach-report/core";

const template = createTemplate()                    // 单页快路径：链式直接 build
  .page(210, 297, { marginTopMm: 12 })               // 纸张 mm + 页边距
  .text("出库单", { leftMm: 70, topMm: 2, widthMm: 70 }, { fontSize: 16, bold: true, align: "center" })
  .barcode("CK-001", { leftMm: 12, topMm: 14, widthMm: 40, heightMm: 12 })
  .line(12, 28, 186)
  .list("detail", { leftMm: 12, topMm: 32, widthMm: 186 }, [
    { header: "序号", field: "no", widthMm: 30 },
    { header: "物料名称", field: "name", widthMm: 156 }
  ], { fontSizePt: 10, headerEveryPage: true })
  .build();                                          // → ReportTemplate，直接进 paginateTemplate

// 多页：done() 回到容器
const t = createTemplate();
t.page().text("第一页", { topMm: 5 });
t.page().text("第二页", { topMm: 5 });
t.build();
```

### jh4j 模板导入

```ts
import { importJh4jTemplateContent } from "@mach-report/core";
const { template, warnings } = importJh4jTemplateContent(jh4jContentJsonOrString);
// 文本/表格/线条/形状完整转换；图片类降级为占位；富文本降级纯文本；未知类型告警跳过，永不抛错
```

## @mach-report/manager — 管理端 API 客户端

```ts
import { createReportAdminClient } from "@mach-report/manager";

const admin = createReportAdminClient({ request: platformRequest });  // 注入平台 request
await admin.listReports({ keyword: "出库" });        // 模板列表
await admin.getReport(id);                           // 详情（content 为 jh4j 模板 JSON）
await admin.updateReport({ id, name, content });     // 保存
await admin.exportDefinition([id1, id2]);            // 导出 ZIP
await admin.importDefinition(file, "overwrite");     // 导入
await admin.listDatasets(id); await admin.listParams(id);

// 模板锁：进入设计器前持有，40s 自动心跳，异常也保证释放
await admin.holdLock(reportId, async () => { /* 编辑保存 */ });
```

## @mach-report/pdf — 前端矢量 PDF 直出

```ts
import { renderPlanToPdf } from "@mach-report/pdf";

const fontBytes = new Uint8Array(await (await fetch("/simhei.ttf")).arrayBuffer());
const { bytes } = await renderPlanToPdf(plan, { customFontBytes: fontBytes });  // 子集嵌入中文字体
// bytes → Blob → 下载；未提供字体时降级 Helvetica（CJK 计入 unsupportedTextCount 不崩溃）
```

## @mach-report/sql-engine — 动态 SQL

```ts
import { compileDynamicSql, renderDynamicSql } from "@mach-report/sql-engine";

const c = compileDynamicSql(
  "select * from t where 1=1 {if(isEmpty(#id), \"\", \"and id = #{id}\")}"
);
c.paramNames;                        // ["id"]
c.render({ id: "A" });               // { sql: "... and id = ?", binds: ["A"], warnings: [] }
renderDynamicSql(sql, params);       // 渲染 + 单 SELECT 校验一体（非法即抛）
```

语法：`#{p}` 绑定 / `${p}` 文本替换 / `{if(cond, whenTrue, whenFalse)}`（cond 支持 `isEmpty(#p)` `#p == ""` `+` 拼接；嵌套 if 用未引用分支回退）。公式内字符串仅双引号；`\{` 输出字面大括号。

## @mach-report/federation — 模块联邦入口

expose 路径与 jh4j 对齐：`./mach-report/reportPreview` / `./reportHtmlPreview` / `./filePreview`。宿主通过 `provide(MACH_REPORT_FETCHER_KEY, fetcher)` 注入数据面。

## CLI 验证

```bash
pnpm typecheck   # tsc -b
pnpm lint        # eslint（0 errors 基线）
pnpm test        # vitest 106 用例 + 性能预算门
pnpm exec playwright test   # 真浏览器 E2E（自动起 example dev server）
```
