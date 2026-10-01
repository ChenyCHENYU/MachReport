<div align="center">

# MachReport

**面向 B 端打印报表的高性能 TypeScript 报表引擎**

一个包 · 一个插件 · 一行组件 —— 契约级兼容 jh4j-cloud-report，渲染性能与工程健壮性全面升级

[快速开始](#快速开始) · [配置中心](#配置中心) · [引擎 API](#引擎-api框架无关) · [架构](#架构) · [性能](#性能) · [从-jh4j-迁移](#从-jh4j-迁移)

</div>

---

## 它解决什么问题

现网 jh4j-cloud-report 的痛点（逆向分析结论，详见 [docs/reverse-findings.md](docs/reverse-findings.md)）：

| jh4j 现状 | 问题 | MachReport 的解法 |
|---|---|---|
| 预览全量 DOM（shadow DOM + 全页渲染） | 大报表首屏慢、缩放重排 | 页级虚拟化 + transform 缩放（零重排）+ Canvas 窗口化分页器 |
| PDF 走后端渲染管线 | 每次打印一次后端往返；HTML/PDF 两套实现互相不一致 | **单真相源**：RenderPlan 一份中间表示 → 屏幕 / PDF 前端直出 / 打印三出口 |
| 动态 SQL 靠字符串规则 | 校验弱、注入面大 | 词法 + AST 双层"仅单条 SELECT"结构性校验 |
| 换单据闪旧内容 | 依赖业务方记得加 `:key` | 组件层代际令牌根治竞态 |
| 闭源产物 | 无法二开/自修/自部署 | 源码自有，全绿质量门禁（typecheck/lint/单测/E2E，命令见下） |

## 30 秒接入（像 mach-table 一样快）

```bash
pnpm add @agile-team/mach-report        # 唯一依赖（vue 是可选 peer，宿主已有）
```

```ts
// main.ts —— 应用入口一次注册，之后业务页面零胶水
import { machReportPlugin } from "@agile-team/mach-report/vue";
import "@agile-team/mach-report/vue/style.css";

app.use(machReportPlugin);              // 零配置：同源直连 jh4j 端点
// 或 app.use(machReportPlugin, { baseUrl: "/sub/mach-report", request: axios });
```

```vue
<!-- 任意业务页面 —— 一行组件，全局组件名 MachReportPreview 已注册 -->
<template>
  <MachReportPreview temp-id="CK_TEMPLATE_001" :params="{ id: '9' }" height="calc(100vh - 206px)" />
</template>
```

完成。打印 / 导出 PDF / 导出 HTML / 翻页 / 缩放 / 多模板拼接全部内置。

## 特性总览

| 能力 | 状态 | 说明 |
|---|---|---|
| 分页引擎 | ✅ | 模板 + 数据 → RenderPlan；5,000 行 ~57ms；列表自动跨页/表头重复/列宽等比缩放 |
| **报表语义** | ✅ | 分组小计/总合计（组头防孤行）、页码占位符 `{page}/{totalPages}`、列格式化（千分位/日期/百分比）、条件格式规则 |
| 屏幕预览（DOM 后端） | ✅ | 页级虚拟化、transform 缩放、named pages 混合纸张打印、流式分块写入 |
| Canvas 后端 | ✅ | 窗口化分页器（画布池 + 分帧渲染），内存 O(窗口) 而非 O(总页数) |
| PDF / Excel 前端直出 | ✅ | PDF 矢量（字体子集化 + IndexedDB 缓存）；`./xlsx` 子路径导出对账表（合并/列宽/样式直译） |
| **预览交互** | ✅ | 搜索（索引→跳页→高亮）、Ctrl+滚轮缩放、PgUp/PgDn/Home/End 翻页、缩略图侧栏、缩放记忆 |
| 动态 SQL | ✅ | `#{}` `${}` `{if}` 三语法兼容存量；AST 级单 SELECT 校验 |
| 管理端 API | ✅ | 模板/数据集/参数/导入导出/模板锁（心跳丢失感知） |
| Vue 契约组件 | ✅ | props/事件/ref 与 jh4j 1:1；竞态防护；配置中心（presets/文案/主题）；批量打印 `printPlans` |
| 调试面板 | ✅ | `?mrp-debug=1`：页窗/加载耗时/计划体积悬浮窗 |
| jh4j 模板导入 | ✅ | 逆向 schema 驱动，存量模板 content 直接转换 |
| 模块联邦入口 | ✅ | expose 名对齐，宿主 harness 实证零改动切换 |
| 设计器画布 UI | 🚧 | 后续里程碑 |

---

## 报表语义（B 端刚需四件套）

```ts
const template = createTemplate()
  // 参数面板：声明式定义 → 组件自动生成查询条件（使用侧零表单代码）
  .params([
    { field: "whCode", label: "仓库", type: "select", required: true, options: [
      { label: "全部仓库", value: "ALL" }, { label: "1号库", value: "W1" }
    ], defaultValue: "ALL" },
    { field: "date", label: "日期", type: "date", defaultValue: "2026-09-30" }
  ])
  .page("a4", { margins: { marginTopMm: 12, marginBottomMm: 15 } })
  .text("出库单明细", { leftMm: 65, topMm: 4, widthMm: 80 }, { fontSize: 16, bold: true, align: "center" })
  // 页脚：每个输出页自动克隆注入
  .text("第 {page} 页 / 共 {totalPages} 页", { leftMm: 65, topMm: 285, widthMm: 80 }, { align: "center" })
  .list("detail", { leftMm: 12, topMm: 18, widthMm: 186 }, [
    { header: "物料", field: "name", widthMm: 96 },
    { header: "数量", field: "qty", widthMm: 45, format: { kind: "number", thousands: true } },
    { header: "金额", field: "amount", widthMm: 45, format: { kind: "number", thousands: true, digits: 2 },
      rules: [{ when: { field: "amount", op: "<", value: 0 }, style: { color: "#cc0000" } }] },
    { header: "日期", field: "date", widthMm: 45, format: { kind: "date", pattern: "YYYY-MM-DD" } }
  ], {
    groupBy: { field: "wh", headerTemplate: "仓库：{value}", subtotal: ["qty", "amount"] },
    grandTotal: true
  })
  .build();
```

- **格式化**在进 RenderPlan 之前完成（`formatValue`，JSON 声明式不破坏 gridPlan 契约），三后端零感知。语义：`digits` 显式即精确保留（`12.50` 不截尾）；`thousands` 缺省 `false`（千分位显式开启）；日期串按**本地日历日**解析（不受 UTC 时区偏移）
- **分组小计**：组头跨全列、组尾数值列求和（沿用列格式化）、`keepWithNext` 防组头孤行、末页总合计
- **页码占位符**：含 `{page}/{totalPages}` 的文本组件转为"页锚"，每个输出页克隆注入，收尾回填总页数
- **条件格式**：声明式规则命中才克隆样式（未命中行保持驻留引用，热路径零分配）

### 参数面板（P3 项已落地：声明式查询条件，宿主零表单代码）

参数定义放模板（`.params([...])`）或直接给组件 prop（`paramDefs`，优先级更高）——组件自动渲染查询面板（文本/数字/日期/下拉、必填校验、默认值、查询/重置、回车查询），查询时面板值与 `props.params` 合并后重新加载：

```vue
<ReportPreview
  temp-id="CK_001"
  :param-defs="[
    { field: 'whCode', label: '仓库', type: 'select', required: true, options },
    { field: 'date', label: '日期', type: 'date', defaultValue: '2026-09-30' }
  ]"
/>
<!-- 自己做表单？show-params=false 关面板，params 照常传 -->
```

面板显隐走配置中心（`defaults.showParams`，缺省 true）；文案（paramsTitle/query/reset/paramRequired）与主题同渠道可配。连续填写多参数不丢值（本地字典为唯一真相的根源设计）。

---

## 预览交互

| 操作 | 行为 |
|---|---|
| `Ctrl` + 滚轮 | 以光标为中心缩放（30%~300%） |
| `PgUp` / `PgDn` / `Home` / `End` | 翻页导航（预览区聚焦时） |
| `+` / `-` | 步进缩放 |
| `Ctrl` + `F` | 打开预览内搜索：全文索引 → 跳页 → 命中高亮（`mark.mrp-hit`） |
| 工具栏 ▦ 缩略图 | 侧栏懒渲染小画布，点击导航 |
| 缩放记忆 | 上次的缩放模式存 localStorage，重进恢复 |
| 调试 | URL 加 `?mrp-debug=1`：页窗区间/加载耗时/计划体积悬浮窗 |

**批量打印（多单连打）**：把多份计划合并为一个打印文档，混合纸张经 named pages 正确分页，只弹一次打印框：

```ts
import { printPlans } from "@agile-team/mach-report/vue";
await printPlans([plan1, plan2, plan3], { onProgress: (done, total) => setLoading(`${done}/${total}`) });
```

---

## Excel 导出（./xlsx 子路径）

```ts
import { renderPlanToXlsx } from "@agile-team/mach-report/xlsx";
const { buffer, warnings } = await renderPlanToXlsx(plan);
// buffer → Blob 下载（.xlsx）；网格→真表格（列宽 mm 直译、colSpan 合并、底色/加粗/对齐），
// 文本→合并标题行；图片/条码计入 warnings 保真告警（与 PDF 同口径）
```

---

## 打印兼容性指引（实战排障）

| 现象 | 原因与处理 |
|---|---|
| 表格底色打印丢失 | 浏览器默认关闭"背景图形"——打印对话框勾选*背景图形*（Chrome/Edge：更多设置） |
| 混合纸张按 A4 输出 | named pages 需要较新内核（Chrome 85+/Safari 16+/Firefox 133+）；旧内核退化为统一纸张，可在调试面板确认 |
| iOS App 内打印无效 | WKWebView 限制系统打印面板——引导用户走"分享 → 打印"或导出 PDF |
| 字体首载后失效 | PDF 字体走 IndexedDB 缓存（15s 超时回退内置西文字体），清理站点数据后重新拉取 |

---

## 快速开始

### 安装

```bash
pnpm add @agile-team/mach-report
```

单包架构：**只有一个 npm 包**。框架组件在 `./vue` 子路径（vue 为 optional peer——React/Node 宿主不会被装上 vue）；重依赖 pdf-lib / node-sql-parser 已内联进 `./pdf` `./sql` 子路径产物，不导入不进依赖图。

### 三种集成姿势

**① 全局插件（推荐）** —— 上文 30 秒接入即是。插件会：

- 注册全局组件 `<MachReportPreview>`（可用 `globalComponent: false` 关闭）
- 注入数据面（fetcher / request / 内置 fetch 零配置三选一）
- 注入 PDF 导出器（懒加载 `./pdf`，支持自定义接管）
- 注入配置中心

```ts
app.use(machReportPlugin, {
  baseUrl: "/sub/mach-report",     // 网关前缀（可选）
  request: axios,                  // 宿主 http 客户端（可选；缺省用全局 fetch）
  fetcher: customFetcher,          // 完整数据面（可选，优先级最高）
  config: machReportConfig,        // 配置中心（见下节）
  pdfFontUrl: "/simhei.ttf",       // PDF 中文字体（'' 跳过）
  pdfExporter: customExporter,     // 接管 PDF 导出（如 Worker 化）
  globalComponent: true            // 注册全局 <MachReportPreview>（默认 true）
});
```

**② 局部导入** —— 单页面使用，不动全局：

```vue
<script setup lang="ts">
import { ReportPreview, createLocalFetcher } from "@agile-team/mach-report/vue";

const fetcher = createLocalFetcher({
  T1: { tempId: "T1", template, datasets: { detail: rows } }
});
</script>
<template>
  <ReportPreview temp-id="T1" :fetcher="fetcher" @loaded="onLoaded" @error="onError" />
</template>
```

**③ 异步入口（首屏敏感页面）** —— 组件拆独立分片，路由级按需：

```ts
import AsyncMachReportPlugin, { preloadMachReport } from "@agile-team/mach-report/vue/async";
app.use(AsyncMachReportPlugin, { baseUrl: "/sub/mach-report" });
void preloadMachReport();          // 可选：路由 hover 时预取
// 模板：<MachReportPreview temp-id="X" />
```

### 组件 API（ReportPreview / MachReportPreview）

| props | 类型 / 默认 | 说明 |
|---|---|---|
| `temp-id` | `string \| string[]` | 逗号串/数组 = 多模板按序拼接 |
| `furniture-temp-id` | `string` | 公共页眉页脚模板 |
| `params` | `Record<string, string>` | 报表参数（键名区分大小写） |
| `height` | `"100vh"` | 弹窗内建议 `calc(100vh - 280px)` |
| `auto-load` | `true` | 挂载即加载 |
| `show-export` / `show-print` / `show-pdf-window` | `undefined` | **不传走配置中心**（preset > defaults > 缺省 true）；显式传值优先级最高 |
| `gap-px` | `undefined` | 页间距 px；不传走配置中心（缺省 18） |
| `messages` | `Partial<Messages>` | 文案覆写（i18n） |
| `preset` | `string` | 启用配置中心的指定 preset |
| `fetcher` | `PlanFetcher` | 数据面；不传回落插件注入 |

| emits / ref | 形状 | 说明 |
|---|---|---|
| `@loaded` | `(pageCount)` | 加载完成 |
| `@error` | `(message, detail?)` | 错误（第二参数为结构化 `{ code, cause }`，可选） |
| ref 方法 | `reload()` `print()` `exportAs(fmt)` `openPdfWindow()` `gotoPage(n)` | 编程式控制 |

编程式访问也可用 composable：

```ts
import { useReportPreview } from "@agile-team/mach-report/vue";
// 在任意后代组件中（无需模板 ref）
const preview = useReportPreview();
preview.value?.print();
```

---

## 配置中心

约定集中到独立配置文件（对齐 mach-table 的 `defineMachTableConfig` 体验）：

```ts
// src/config/mach-report.config.ts
import {
  defineMachReportConfig,
  defineMachReportPreset
} from "@agile-team/mach-report/vue";

export default defineMachReportConfig({
  defaults: {
    showExport: true,             // 工具栏显隐
    showPrint: true,
    showPdfWindow: true,
    gapPx: 18,                    // 页间距
    pdfFontUrl: "/simhei.ttf",    // PDF 中文字体
    messages: { title: "报表预览", print: "打印", pageInfo: "{cur} / {total}" }, // 全量文案可覆写
    theme: { shellBg: "#525659", btnActiveBg: "#2d5fb8" }                        // --mrp-* 主题变量
  },
  presets: {
    lean:  defineMachReportPreset({ showExport: false, showPrint: false }),  // 纯预览
    print: defineMachReportPreset({ showPdfWindow: false })
  },
  defaultPreset: "lean"
});
```

**优先级**：`组件 props` > `provideMachReportConfig(overlay)`（路由级响应式叠加）> `preset` > `defaults` > `内置缺省`。

`defaults` 另支持 `logger`：校验告警通道（默认 `console`；静默传 `SILENT_LOGGER`，或注入上报 collector）。

```vue
<script setup>
// 某路由关闭打印、覆写标题（不影响全局）
import { provideMachReportConfig } from "@agile-team/mach-report/vue";
provideMachReportConfig({ showPrint: false, messages: { title: "工艺卡" } });
</script>
```

主题也可不经配置中心，直接在宿主 CSS 覆写变量：`--mrp-shell-bg / --mrp-toolbar-bg / --mrp-btn-*`。

---

## 数据面（fetcher 生态）

| 工具 | 场景 |
|---|---|
| 内置（零配置） | 插件不传 request/fetcher 时，自动用全局 fetch 同源请求 `/report/codePrintReport/gridPlan` |
| `createFetchRequest({ baseUrl, headers, credentials, timeoutMs })` | 零依赖 fetch 适配（含超时与错误语义） |
| `createJh4jGridPlanFetcher({ request, baseUrl })` | 接宿主 axios 风格客户端，消费 jh4j gridPlan |
| `createLocalFetcher({ [tempId]: { template, datasets } })` | 本地模板（离线 / 单测 / 无后端） |

自定义数据面只需实现一个函数签名：

```ts
type PlanFetcher = (input: {
  tempIds: string[];
  furnitureTempId?: string;
  params: Record<string, string>;
}) => Promise<RenderPlan>;
```

---

## 引擎 API（框架无关）

主入口与子路径按需引入（均为 ESM + CJS 双格式）：

```ts
import { /* 引擎核心 */ } from "@agile-team/mach-report";
import { renderPlanToPdf, loadFontWithCache } from "@agile-team/mach-report/pdf";
import { renderPlanToXlsx } from "@agile-team/mach-report/xlsx";
import { compileDynamicSql, renderDynamicSql } from "@agile-team/mach-report/sql";
import { createReportAdminClient } from "@agile-team/mach-report/manager";
```

### 渲染管线（单真相源）

```
模板 JSON ──+──> paginateTemplate(template, datasets, { measurer? }) ──> RenderPlan
             │                                                        │
jh4j gridPlan ──（兼容消费，schemaVersion 标识）                        ├──> DOM 渲染（虚拟化预览）
                                                                      ├──> Canvas 窗口化分页器
                                                                      ├──> PDF 矢量直出
                                                                      └──> print 管线（named pages）
```

### 常用引擎函数

```ts
import {
  createTemplate,          // 模板构建器 DSL
  paginateTemplate,        // 分页计算
  renderPlan, renderPage,  // RenderPlan → DOM
  renderPlanToCanvas,      // RenderPlan → Canvas 位图页（支持 start/end 区间）
  createCanvasPager,       // Canvas 窗口化分页器（大报表必用）
  computePageWindow,       // 页级虚拟化窗口计算
  validateRenderPlan,      // 渲染计划校验（JSON path 定位错误）
  importJh4jTemplateContent, // jh4j 模板 content → 本地模板
  wrapText, createCanvasMeasurer, // 文本测量（可注入，三端折行一致）
  resolveGridLayout        // 网格几何（colWidths/rowHeights/span/边线）
} from "@agile-team/mach-report";
```

### 模板构建器 DSL

```ts
const template = createTemplate()
  .page("a4", { landscape: true, margins: { marginTopMm: 12 } })   // 纸张预设（a3/a4/a5/b4/b5）+ 横向
  .text("出库单", { leftMm: 70, topMm: 2, widthMm: 70 }, { fontSize: 16, bold: true, align: "center" })
  .barcode("CK-001", { leftMm: 12, topMm: 14, widthMm: 40, heightMm: 12 })
  .line(12, 28, 186)
  .list("detail", { leftMm: 12, topMm: 32, widthMm: 186 }, [
    { header: "序号", field: "no", widthMm: 30 },
    { header: "物料名称", field: "name", widthMm: 156 }
  ], { fontSizePt: 10, headerEveryPage: true })
  .build();
```

### 大报表 Canvas 渲染

```ts
const pager = createCanvasPager(plan, { dpr: window.devicePixelRatio, overscan: 1 });
pager.attach(scrollContainer);   // 视口窗口 + 画布池复用 + 每帧限量绘制 + resize 自适应
pager.destroy();
```

---

## 架构

```
MachReport（pnpm monorepo · TS strict · 单 npm 包）
├── packages/
│   ├── mach-report/                  # 唯一发布包（零运行时依赖，ESM+CJS）
│   │   └── src/
│   │       ├── layout/               # 分页计算 / 文本折行（TextMeasurer 注入）
│   │       ├── render/               # DOM/Canvas 渲染器 / 网格几何 / 样式单源 / 虚拟化窗口
│   │       ├── schema/               # RenderPlan 模型与校验
│   │       ├── builder/              # 模板 DSL
│   │       ├── compat/               # jh4j 模板导入
│   │       ├── pdf/  sql/  manager/  # 子路径域（重依赖内联、按需引入）
│   │       └── vue/                  # ./vue 子路径域（契约组件/插件/配置中心/composables）
│   └── federation/                   # 模块联邦远程入口（部署产物，不发 npm）
├── examples/                         # minimal 演示 + fed-host 联邦宿主实证
├── e2e/                              # Playwright（真 Chromium 9 specs）
└── docs/                             # PROGRESS / API / 逆向结论
```

**核心设计决策**

1. **单真相源渲染**：一份 RenderPlan 中间表示派生屏幕 / PDF / 打印三出口，结构上消灭 jh4j 的双实现漂移
2. **单包 + 子路径**：目录架构 + exports 子路径替代分包；框架代码、重依赖均按需隔离，主入口零耦合（ESLint 边界规则 + 产物守卫测试双保险）
3. **自引用（self-reference）**：`./vue` 静态依赖引擎、PDF 懒加载走 `./pdf`，运行时经本包 exports 解析——引擎代码全局单份
4. **三后端共享几何与样式解析**：网格几何（列宽/行高/span/边线）、字号/描边/边框开关全部单源，后端只做"打印指令"
5. **性能预算门禁**：分页/渲染耗时进单测断言，回归即红

## 性能

| 指标 | jh4j 现状（实测感知） | MachReport 实测 |
|---|---|---|
| 分页 5,000 行（139 页） | 秒级（全量 DOM） | **~57ms**（热路径样式驻留 + 字宽查表，单测预算门锁定） |
| 100 页含千行明细首屏 | 秒级 | < 300ms（虚拟化 + Canvas 窗口化） |
| 缩放 / 翻页 | 触发重排 | < 16ms（transform 矩阵变换，无重排） |
| Canvas 大报表内存 | — | **O(窗口)**：画布池复用 + 分帧（A4@dpr2 ≈14MB/页，全量渲染不可行） |
| 打印 / PDF 导出 | 后端往返 1-3s | < 500ms（前端矢量直出，字体子集化 + IndexedDB 缓存）；打印流式分块无长任务 |
| 引擎包体积 | 随 jh4j 整包 | 主入口 ~27KB min（零依赖可摇树），重能力子路径按需 |

## 健壮性设计

- 模板校验给 JSON path 行级定位；数据集缺失降级为告警而非整报失败
- 组件层代际令牌根治"换单据闪旧内容"竞态
- 渲染计划规模上限告警（防异常大计划拖垮页面）
- 模板锁心跳丢失感知（onLockLost 回调）；字体加载超时与并发去重
- 打印/PDF 导出并发防抖；导出器懒加载且可注入接管
- E2E 对齐 MachTable 工程标准：真 Chromium 结构化像素断言（Y 轴/几何回归门）、0 重试稳定

## 从 jh4j 迁移

| 契约项 | 对齐方式 |
|---|---|
| 组件 props/事件/ref | `temp-id / furniture-temp-id / params / height / auto-load / show-*`；`loaded(pageCount) / error(message)`；`reload / print / exportAs / openPdfWindow / gotoPage` 1:1 |
| 数据接口 | `/report/codePrintReport/gridPlan` 路径与出入参兼容（`createJh4jGridPlanFetcher`） |
| 存量模板 | `importJh4jTemplateContent` 逆向 schema 直接转换（含告警清单） |
| 存量 SQL | `#{}` `${}` `{if}` 三语法零改写；编译期 AST 校验加严 |
| 模块联邦 | expose 名对齐，宿主配 `/sub/mach-report/` 网关即可灰度共存 |

## 质量门禁

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm exec playwright test
# TS strict(含 vue-tsc) · ESLint 0 错 0 警 · 205+ 单测 · 9 E2E（0 重试）· 六入口产物构建
```

## 文档

- [docs/PROGRESS.md](docs/PROGRESS.md) —— 迭代日志与决策记录（六轮优化全轨迹）
- [docs/API.md](docs/API.md) —— 接入速查
- [docs/reverse-findings.md](docs/reverse-findings.md) —— jh4j 逆向结论

## 工程标准（对齐 MachTable）

pnpm monorepo / TypeScript strict / 引擎零运行时依赖 / changesets 版本管理 / ESLint / Vitest + Playwright / CI（GitHub Actions）

---

<div align="center">

Mach 家族：[MachTable](https://www.npmjs.com/package/@agile-team/mach-table)（数据表格）→ **MachReport**（打印报表）

</div>
