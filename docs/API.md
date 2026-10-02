# MachReport API 速查

> 面向接入方的一页纸。完整类型见各包 `src/`。

## @agile-team/mach-report/vue — 业务接入（最常用）

```vue
<script setup lang="ts">
import ReportPreview from "@agile-team/mach-report/vue";
import { createLocalFetcher, createJh4jGridPlanFetcher } from "@agile-team/mach-report/vue";

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
| auto-load | true | 挂载即加载 |
| show-export / show-print / show-pdf-window | undefined | **不传走配置中心**（preset > defaults > 内置缺省 true）；显式传值优先级最高 |
| gapPx | undefined | 页间距 px；不传走配置中心（缺省 18） |
| messages | Partial\<MachReportMessages\> | 工具栏/状态文案覆写（i18n） |
| preset | string | 启用配置中心的指定 preset |
| fetcher | PlanFetcher \| null | 数据面；**不传时回落插件注入（见下）** |

emits：`loaded(pageCount)` / `error(message, detail?)` / `warning(message)`（导出保真告警）；ref：`reload / print / exportAs(format) / openPdfWindow / gotoPage(n) / setParams(values, { reload? })`（编程式设参查询，面板同步显示）

### 插件（零配置可用：一次注册，业务页面一行使用）

```ts
import { machReportPlugin } from "@agile-team/mach-report/vue";

app.use(machReportPlugin);       // 零配置：全局 fetch 同源直连 jh4j 端点；token 拦截器场景传宿主 request
app.use(machReportPlugin, {
  baseUrl: "/sub/mach-report",   // 或 request: axios（axios 风格签名），
  config: machReportConfig,      // 或 fetcher: 自定义 PlanFetcher（优先级最高）
  pdfFontUrl: "/simhei.ttf",     // '' 跳过中文字体
  pdfExporter: customExporter,   // 可选：接管 PDF 导出（如 Worker 化）
  globalComponent: true          // 注册全局 <MachReportPreview>（默认 true，懒加载分片）
});
```

插件默认注册全局组件 `<MachReportPreview>`（`defineAsyncComponent` 懒加载——首次渲染才拉组件分片，首屏零成本）。

### 编程式访问与插槽

```vue
<!-- 后代组件免模板 ref；也可用 overlay 插槽放自定义操作 -->
<ReportPreview temp-id="T1">
  <button class="my-btn" @click="preview?.print()">打印本单</button>
</ReportPreview>

<script setup>
import { useReportPreview } from "@agile-team/mach-report/vue";
const preview = useReportPreview();   // 不在预览组件内时为 null（不抛错）
</script>
```

### 结构化错误（向后兼容）

`error` 事件保持 `(message: string)` 契约，新增第二参数 `{ code, cause? }`：
`code ∈ param | fetch | validate | render | pdf | print | export | config`（`MachReportError` 类同形导出），
宿主可按码决定 UX（网络类给重试、配置类给提示）。
耗时较长的导出会显示“正在生成”；PDF 或 Excel 版式降级时展示提示条并触发 `warning(message)`。

```ts
<ReportPreview @error="(msg, detail) => detail?.code === 'fetch' && showToast(msg)" />
```

### 配置中心（独立 config 文件 + presets + 路由级叠加）

```ts
// src/config/mach-report.config.ts
import {
  defineMachReportConfig,
  defineMachReportPreset
} from "@agile-team/mach-report/vue";

export default defineMachReportConfig({
  defaults: {
    gapPx: 18,
    pdfFontUrl: "/simhei.ttf",
    messages: { title: "Report Preview" },           // 工具栏/状态/错误文案（i18n）
    theme: { shellBg: "#2b2b2b", btnActiveBg: "#1677ff" }
  },
  presets: { lean: defineMachReportPreset({ showExport: false }) },
  defaultPreset: "lean"
});
```

优先级：**props > `provideMachReportConfig(overlay)`（路由级响应式叠加）> preset > defaults > 内置缺省**。

```vue
<script setup>
// 某路由关闭打印按钮（不影响全局）
import { provideMachReportConfig } from "@agile-team/mach-report/vue";
provideMachReportConfig({ showPrint: false, messages: { title: "工艺卡" } });
</script>
```

### 异步入口（首屏敏感页面）

```ts
import AsyncMachReportPlugin, { preloadMachReport } from "@agile-team/mach-report/vue/async";
app.use(AsyncMachReportPlugin, { baseUrl: "/sub/mach-report" });
void preloadMachReport();   // 路由 hover 预取组件分片
// 模板：<MachReportPreview temp-id="X" />
```

主题：工具栏/外壳颜色走 CSS 变量 `--mrp-shell-bg / --mrp-toolbar-bg / --mrp-btn-*`（配置中心 `theme` 或宿主 CSS 覆写均可）。

## @agile-team/mach-report — 引擎

```ts
import { paginateTemplate, renderPlan, computePageWindow,
         validateRenderPlan, importJh4jTemplateContent } from "@agile-team/mach-report";

const { plan, warnings } = paginateTemplate(template, datasets);   // 模板+数据 → RenderPlan
// paginateTemplate(template, datasets, { measurer, mmPerRow })    // 可注入文本测量器
validateRenderPlan(plan);            // { ok, errors[], warnings[] } JSON path 定位
const el = renderPlan(plan, document);  // RenderPlan → DOM（框架无关）
computePageWindow({ pageHeightsPx, viewportHeightPx, scrollTopPx, gapPx }); // 虚拟化窗口
importJh4jTemplateContent(content);  // jh4j 模板 content → { template, warnings }
```

Template 模型：`pages[].components[]`，静态组件（text/rect/line/ellipse/image...）+ 列表组件（`kind:"list"`，dataset 引用 + columns 列定义，自动跨页/表头重复；`border:false` 三后端一致去线）。

### Canvas 窗口化分页器（大报表必用）

```ts
import { createCanvasPager, renderPlanToCanvas } from "@agile-team/mach-report";

// 小报表：一次性渲染（可传 start/end 区间）
const { canvases } = renderPlanToCanvas(plan, { dpr: 2, start: 0, end: 3 });

// 大报表：视口窗口 + 画布池复用 + 每帧限量分帧（内存 O(窗口)）
const pager = createCanvasPager(plan, { dpr: devicePixelRatio, overscan: 1, gapPx: 18 });
pager.attach(scrollContainer);      // 容器需 overflow:auto
pager.window();                     // 当前渲染区间 { start, end }
pager.destroy();
```

### 文本测量器（三端折行一致性的开关）

```ts
import { createCanvasMeasurer, heuristicMeasurer, paginateTemplate } from "@agile-team/mach-report";

const measurer = createCanvasMeasurer(() => someCanvas.getContext("2d")); // 浏览器真字体
const { plan } = paginateTemplate(template, data, { measurer });          // 分页与 PDF/Canvas 共用
```

### 模板构建器 DSL

```ts
const template = createTemplate()                    // 单页快路径：链式直接 build
  .page("a4", { landscape: true, margins: { marginTopMm: 12 } })   // 纸张预设（a3/a4/a5/b4/b5）
  .text("出库单", { leftMm: 70, topMm: 2, widthMm: 70 }, { fontSize: 16, bold: true, align: "center" })
  .barcode("CK-001", { leftMm: 12, topMm: 14, widthMm: 40, heightMm: 12 })
  .line(12, 28, 186)
  .list("detail", { leftMm: 12, topMm: 32, widthMm: 186 }, [
    { header: "序号", field: "no", widthMm: 30 },
    { header: "物料名称", field: "name", widthMm: 156 }
  ], { fontSizePt: 10, headerEveryPage: true })
  .build();                                          // → ReportTemplate，直接进 paginateTemplate
// .page(210, 297, { marginTopMm: 12 })              // 数字纸张写法兼容
```

### 报表语义（分组/格式化/页码/条件格式）

```ts
// 列定义增强
{ header: "金额", field: "amount", widthMm: 45,
  format: { kind: "number", thousands: true, digits: 2 },      // 千分位+2位小数
  rules: [{ when: { field: "amount", op: "<", value: 0 }, style: { color: "#cc0000" } }] }  // 负数红字
{ header: "日期", field: "date", widthMm: 45, format: { kind: "date", pattern: "YYYY-MM-DD" } }

// 列表选项
.list("detail", geom, columns, {
  groupBy: { field: "wh", headerTemplate: "仓库：{value}", subtotal: ["qty", "amount"], keepWithNext: true },
  grandTotal: true            // 末尾总合计（沿用 subtotal 字段，或 grandTotal: { fields: [...] }）
})

// 页码占位符（页锚：每个输出页克隆注入）
.text("第 {page} 页 / 共 {totalPages} 页", { leftMm: 65, topMm: 285, widthMm: 80 }, { align: "center" })
```

### 参数面板（声明式查询条件，使用侧零表单代码）

```ts
// 模板内声明（builder）——或组件 prop paramDefs（优先级更高）
createTemplate().params([
  { field: "whCode", label: "仓库", type: "select", required: true, options: [{ label: "1号库", value: "W1" }] },
  { field: "date", label: "日期", type: "date", defaultValue: "2026-09-30" }
]).page("a4").text("出库单", { topMm: 4 }).list(...).build();
```

```vue
<ReportPreview temp-id="CK_001" :param-defs="defs" />   <!-- 或直接 prop -->
```

- 控件四类：text / number / date / select；支持 defaultValue / required / placeholder / options
- 查询时**面板值 > props.params** 合并后重新加载；宿主更新 `params` 会同步面板，清空可选条件会移除旧值；回车即查询；重置恢复默认
- 必填缺失：拦截查询并红框提示 + `error(message, { code: "param" })`
- 显隐与文案走配置中心：`defaults.showParams`（缺省 true）、`messages.paramsTitle/query/reset/paramRequired`
- 自己做表单：`show-params="false"` 关面板，`params` 照常传

### 图片 / Word 导出与 Node 无头通道

```ts
// 引擎层：每页一张图片 Blob（png/jpeg，区间/dpr/质量可配）
import { renderPlanToImages } from "@agile-team/mach-report";
const { blobs } = await renderPlanToImages(plan, { format: "png", dpr: 2 });

// 组件层：工具栏"导出 Excel / 导出图片 / 导出 Word"，或编程式
preview.value?.exportAs("xlsx");  // 等价 excel，下载真正的 .xlsx
preview.value?.exportAs("png");   // 等价 image
preview.value?.exportAs("word");  // 等价 doc，产出可编辑 .doc（Word 兼容 HTML）
```

`exportAs` 还支持 `html`、`pdf`；未知格式报 `export` 错误，不会把 HTML 冒充其他扩展名。`openPdfWindow()` 打开真正的 PDF；中文缺字或 PDF 页渲染错误会阻止下载。Excel 不做像素级排版复制，图片/条码/图表跳过时通过 `warning` 事件和组件提示条告知。中文 PDF 使用前请部署字体并设置 `pdfFontUrl`。

**Node 无头导出**：`renderPlanToPdf` / `renderPlanToXlsx` / `loadFontWithCache` 均可在 Node 18+ 运行
（无 IndexedDB 环境自动降级内存缓存）——定时任务、邮件推送、归档留档用同一引擎，服务端零渲染代码。

### Excel 导出 / 批量打印

```ts
import { renderPlanToXlsx } from "@agile-team/mach-report/xlsx";
const { workbook, buffer, warnings } = await renderPlanToXlsx(plan);

import { printPlans } from "@agile-team/mach-report/vue";
await printPlans([plan1, plan2], { onProgress: (d, t) => console.log(`${d}/${t}`) });
```

### jh4j 模板导入

```ts
import { importJh4jTemplateContent } from "@agile-team/mach-report";
const { template, warnings } = importJh4jTemplateContent(jh4jContentJsonOrString);
// 文本/表格/线条/形状完整转换；图片类降级为占位；富文本降级纯文本；未知类型告警跳过，永不抛错
```

## @agile-team/mach-report/manager — 管理端 API 客户端

```ts
import { createReportAdminClient } from "@agile-team/mach-report/manager";

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

## @agile-team/mach-report/pdf — 前端矢量 PDF 直出

```ts
import { renderPlanToPdf } from "@agile-team/mach-report/pdf";

const fontBytes = new Uint8Array(await (await fetch("/simhei.ttf")).arrayBuffer());
const { bytes } = await renderPlanToPdf(plan, { customFontBytes: fontBytes });  // 子集嵌入中文字体
// bytes → Blob → 下载；未提供字体时降级 Helvetica（CJK 计入 unsupportedTextCount 不崩溃）
```

## @agile-team/mach-report/sql — 动态 SQL

```ts
import { compileDynamicSql, renderDynamicSql } from "@agile-team/mach-report/sql";

const c = compileDynamicSql(
  "select * from t where 1=1 {if(isEmpty(#id), \"\", \"and id = #{id}\")}"
);
c.paramNames;                        // ["id"]
c.render({ id: "A" });               // { sql: "... and id = ?", binds: ["A"], warnings: [] }
renderDynamicSql(sql, params);       // 渲染 + 单 SELECT 校验一体（非法即抛）
```

语法：`#{p}` 绑定 / `${p}` 文本替换 / `{if(cond, whenTrue, whenFalse)}`（cond 支持 `isEmpty(#p)` `#p == ""` `+` 拼接；嵌套 if 用未引用分支回退）。公式内字符串仅双引号；`\{` 输出字面大括号。

## @agile-team/mach-report-federation — 模块联邦入口

expose 路径与 jh4j 对齐：`./mach-report/reportPreview` / `./reportHtmlPreview` / `./filePreview`。宿主通过 `provide(MACH_REPORT_FETCHER_KEY, fetcher)` 注入数据面。

## CLI 验证

```bash
pnpm typecheck   # tsc -b
pnpm lint        # eslint（0 errors 基线）
pnpm test        # vitest 106 用例 + 性能预算门
pnpm exec playwright test   # 真浏览器 E2E（自动起 example dev server）
```
