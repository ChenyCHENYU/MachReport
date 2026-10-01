<div align="center">

<img src="https://raw.githubusercontent.com/ChenyCHENYU/MachReport/main/assets/mach-report-logo.svg" alt="MachReport" width="760" />

# @agile-team/mach-report

**面向 B 端打印报表的高性能 TypeScript 引擎**：模板 → RenderPlan 单真相源 → 屏幕 / PDF / Excel / 打印四出口，
契约级兼容 jh4j-cloud-report——换前端渲染层，后端零改动。

[![npm](https://img.shields.io/npm/v/@agile-team/mach-report.svg?color=2d5fb8)](https://www.npmjs.com/package/@agile-team/mach-report)
[![CI](https://github.com/ChenyCHENYU/MachReport/actions/workflows/ci.yml/badge.svg)](https://github.com/ChenyCHENYU/MachReport/actions/workflows/ci.yml)
[![dependencies](https://img.shields.io/badge/dependencies-0-2ea44f)](https://www.npmjs.com/package/@agile-team/mach-report)
[![node](https://img.shields.io/badge/node-%3E%3D18-2d5fb8)](https://www.npmjs.com/package/@agile-team/mach-report)
[![license](https://img.shields.io/badge/license-Source--Available-4a4d52)](#-license)

[快速开始](#-快速开始) · [核心能力](#-核心能力) · [配置中心](#-配置中心) · [引擎 API](#-引擎-api) · [从 jh4j 迁移](#-从-jh4j-迁移)

</div>

---

## 🚀 快速开始

```bash
pnpm add @agile-team/mach-report        # 唯一依赖：vue 为可选 peer，重能力全部子路径按需
```

```ts
// main.ts —— 入口一次注册，业务页面从此零胶水代码
import { machReportPlugin } from "@agile-team/mach-report/vue";
import "@agile-team/mach-report/vue/style.css";

app.use(machReportPlugin);              // 零配置：同源直连 jh4j 端点
// 或 app.use(machReportPlugin, { baseUrl: "/sub/mach-report", request: axios });
```

```vue
<!-- 任意业务页面：一行组件。打印 / PDF / Excel / 搜索 / 缩略图 / 参数面板全部内置 -->
<MachReportPreview temp-id="CK_TEMPLATE_001" :params="{ id: '9' }" height="calc(100vh - 206px)" />
```

## ✨ 核心能力

| 域 | 能力 |
|---|---|
| **报表语义** | 分组小计 / 总合计（防孤行）、页码占位符 `{page}/{totalPages}`、列格式化（千分位 / 日期 / 百分比）、条件格式规则 |
| **模板体系** | DSL / JSON / jh4j 存量导入三来源；多模板拼接；公共页眉页脚；参数面板（声明式查询条件） |
| **渲染性能** | 5k 行分页 ~57ms；页级虚拟化；transform 缩放零重排；Canvas 窗口化分页器（内存 O(窗口)） |
| **导出出口** | PDF 前端矢量直出（字体子集化 + 缓存）、Excel 真表格（合并 / 列宽 / 样式直译）、打印（named pages 混合纸张 / 流式分块） |
| **预览交互** | 搜索（跳页 + 高亮）、Ctrl+滚轮 / 键盘缩放翻页、缩略图侧栏、缩放记忆、调试面板 `?mrp-debug=1` |
| **工程健壮性** | 加载竞态代际令牌、结构化错误码、请求超时、批量打印合并文档、渲染计划规模告警 |

<details>
<summary><b>📦 单包架构说明（为什么只有一个包）</b></summary>

框架组件在 `./vue` 子路径（vue 声明为 **optional peer**——React / Node 宿主不会被装上 vue）；
pdf-lib / node-sql-parser / exceljs 分别内联进 `./pdf` `./sql` `./xlsx` 子路径产物——**不导入不进依赖图**，
主入口零框架耦合零重依赖（ESLint 边界规则 + 产物守卫测试双保险）。
自引用（self-reference）让 `./vue` 静态复用引擎、PDF 懒加载走 `./pdf`，运行时引擎代码全局单份。
ESM + CJS 双格式 + `.d.ts/.d.cts` 双声明，Node ≥ 18。

</details>

<details>
<summary><b>🧩 三种集成姿势（全局插件 / 局部导入 / 异步入口）</b></summary>

**① 全局插件（推荐）**：上文快速开始即是。插件注册全局组件 `<MachReportPreview>`（懒加载分片零首屏成本）、注入数据面 / PDF 导出器 / 配置中心。

**② 局部导入**——单页面使用：

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

**③ 异步入口**——首屏敏感页面（组件拆独立分片 + 预取）：

```ts
import AsyncMachReportPlugin, { preloadMachReport } from "@agile-team/mach-report/vue/async";
app.use(AsyncMachReportPlugin, { baseUrl: "/sub/mach-report" });
void preloadMachReport();   // 路由 hover 时预取，正式渲染零等待
```

</details>

<details>
<summary><b>🎛️ 配置中心（presets / 文案 / 主题 / 日志通道）</b></summary>

```ts
// src/config/mach-report.config.ts —— 集中到独立配置文件
import { defineMachReportConfig, defineMachReportPreset } from "@agile-team/mach-report/vue";

export default defineMachReportConfig({
  defaults: {
    gapPx: 18,
    pdfFontUrl: "/simhei.ttf",
    showParams: true,                                    // 参数面板
    messages: { title: "Report Preview" },               // 全量文案可覆写（i18n）
    theme: { shellBg: "#2b2b2b", btnActiveBg: "#1677ff" }, // --mrp-* 主题变量
    logger: console                                      // 校验告警通道（静默传 SILENT_LOGGER）
  },
  presets: {
    lean:  defineMachReportPreset({ showExport: false, showPrint: false }),  // 纯预览
    print: defineMachReportPreset({ showPdfWindow: false })
  },
  defaultPreset: "lean"
});
```

**优先级**：`组件 props` > `provideMachReportConfig(overlay)`（路由级响应式叠加）> `preset` > `defaults` > `内置缺省`。

**参数面板**：模板声明 `.params([...])` 或 prop `:param-defs`，组件自动生成查询条件（text / number / date / select、必填、默认值、查询 / 重置 / 回车），查询时面板值与 `props.params` 合并；编程式 `setParams(values)` 同步面板并查询。

**主题**也可不经配置中心，直接在宿主 CSS 覆写 `--mrp-shell-bg / --mrp-toolbar-bg / --mrp-btn-*`。

</details>

<details>
<summary><b>🛠️ 模板 DSL 与报表语义</b></summary>

```ts
const template = createTemplate()
  .params([                                             // 参数面板：声明式查询条件
    { field: "whCode", label: "仓库", type: "select", required: true,
      options: [{ label: "全部仓库", value: "ALL" }], defaultValue: "ALL" },
    { field: "date", label: "日期", type: "date", defaultValue: "2026-09-30" }
  ])
  .page("a4", { landscape: true, margins: { marginTopMm: 12 } })   // 纸张预设 + 横向
  .text("出库单", { leftMm: 70, topMm: 2, widthMm: 70 }, { fontSize: 16, bold: true, align: "center" })
  .text("第 {page} 页 / 共 {totalPages} 页", { leftMm: 65, topMm: 285, widthMm: 80 }, { align: "center" })
  .barcode("CK-001", { leftMm: 12, topMm: 14, widthMm: 40, heightMm: 12 })
  .list("detail", { leftMm: 12, topMm: 32, widthMm: 186 }, [
    { header: "物料", field: "name", widthMm: 96 },
    { header: "数量", field: "qty", widthMm: 45, format: { kind: "number", thousands: true } },
    { header: "金额", field: "amount", widthMm: 45,
      format: { kind: "number", thousands: true, digits: 2 },
      rules: [{ when: { field: "amount", op: "<", value: 0 }, style: { color: "#cc0000" } }] },
    { header: "日期", field: "date", widthMm: 45, format: { kind: "date", pattern: "YYYY-MM-DD" } }
  ], {
    groupBy: { field: "wh", headerTemplate: "仓库：{value}", subtotal: ["qty", "amount"] },
    grandTotal: true
  })
  .build();
```

语义要点：格式化在进 RenderPlan 前完成（三后端零感知，`digits` 显式精确保留、日期按本地日历日解析）；
分组 Map 归组与数据顺序无关；条件规则命中才克隆样式（热路径驻留不破坏）；含占位符的文本转为页锚，每个输出页克隆注入。

</details>

<details>
<summary><b>🔌 数据面（fetcher 生态：零配置 / jh4j / 本地 / 自定义）</b></summary>

| 工具 | 场景 |
|---|---|
| 内置（零配置） | 插件不传 request / fetcher 时自动用全局 fetch 同源请求 `/report/codePrintReport/gridPlan` |
| `createFetchRequest({ baseUrl, headers, credentials, timeoutMs })` | 零依赖 fetch 适配（AbortController 超时 + 错误语义） |
| `createJh4jGridPlanFetcher({ request, baseUrl })` | 接宿主 axios 风格客户端，消费 jh4j gridPlan（路径 / 出入参契约兼容） |
| `createLocalFetcher({ [tempId]: { template, datasets } })` | 本地模板（离线 / 单测 / 无后端）；面板参数用 `:param-defs="template.params"` 直取 |

自定义数据面只需实现：`type PlanFetcher = (input: { tempIds, furnitureTempId?, params }) => Promise<RenderPlan>`——
任何后端能吐 RenderPlan JSON 就能接（schema 有校验器与文档）。

</details>

<details>
<summary><b>⚙️ 引擎 API（框架无关，子路径按需）</b></summary>

```ts
import {
  createTemplate, paginateTemplate,           // 模板 DSL / 分页计算
  renderPlan, renderPage,                     // RenderPlan → DOM
  renderPlanToCanvas, createCanvasPager,      // 位图渲染 / 窗口化分页器（大报表）
  computePageWindow, validateRenderPlan,      // 虚拟化窗口 / 计划校验（JSON path 定位）
  importJh4jTemplateContent,                  // jh4j 模板 content → 本地模板
  wrapText, createCanvasMeasurer              // 文本测量（可注入，三端折行一致）
} from "@agile-team/mach-report";
import { renderPlanToPdf } from "@agile-team/mach-report/pdf";      // PDF 直出（pdf-lib 已内联）
import { renderPlanToXlsx } from "@agile-team/mach-report/xlsx";    // Excel 导出
import { renderDynamicSql } from "@agile-team/mach-report/sql";     // 动态 SQL（AST 校验）
import { createReportAdminClient } from "@agile-team/mach-report/manager"; // 管理端 API
```

**渲染管线（单真相源）**：

```
模板 JSON ──+──> paginateTemplate(template, datasets) ──> RenderPlan
             │                                                   ├──> DOM 虚拟化预览
jh4j gridPlan ──（契约兼容消费）                                 ├──> Canvas 窗口化分页器
                                                                  ├──> PDF 矢量直出
                                                                  └──> print（named pages）
```

**大报表 Canvas**：`createCanvasPager(plan, { dpr, overscan }).attach(scrollContainer)` —— 视口窗口 + 画布池复用 + 每帧限量绘制 + resize 自适应。

**批量打印**：`printPlans([plan1, plan2], { onProgress })` 多单合并单文档（混合纸张 named pages），只弹一次打印框。

</details>

<details>
<summary><b>📊 性能实测</b></summary>

| 指标 | jh4j 现状（实测感知） | MachReport 实测 |
|---|---|---|
| 分页 5,000 行（139 页） | 秒级（全量 DOM） | **~57ms**（单测预算门锁定） |
| 100 页含千行明细首屏 | 秒级 | < 300ms（虚拟化 + Canvas 窗口化） |
| 缩放 / 翻页 | 触发重排 | < 16ms（transform 矩阵变换） |
| Canvas 大报表内存 | — | **O(窗口)**（A4@dpr2 ≈14MB/页，全量渲染不可行） |
| 打印 / PDF 导出 | 后端往返 1-3s | < 500ms（前端矢量直出 + 字体子集化缓存） |
| 引擎主入口体积 | 随 jh4j 整包 | ~27KB min（零依赖可摇树） |

</details>

<details>
<summary><b>🔄 从 jh4j 迁移（契约对照）</b></summary>

| 契约项 | 对齐方式 |
|---|---|
| 组件 props / 事件 / ref | `temp-id / furniture-temp-id / params / height / auto-load / show-*`；`loaded / error`；`reload / print / exportAs / openPdfWindow / gotoPage / setParams` |
| 数据接口 | `/report/codePrintReport/gridPlan` 路径与出入参兼容 |
| 存量模板 | `importJh4jTemplateContent` 逆向 schema 直接转换（含告警清单） |
| 存量 SQL | `#{}` `${}` `{if}` 三语法零改写；AST 级单 SELECT 校验加严 |
| 模块联邦 | expose 名对齐，宿主配 `/sub/mach-report/` 网关即可灰度共存 |

</details>

<details>
<summary><b>🖨️ 打印兼容性指引（实战排障）</b></summary>

| 现象 | 原因与处理 |
|---|---|
| 表格底色打印丢失 | 浏览器默认关闭"背景图形"——打印对话框勾选*背景图形* |
| 混合纸张按 A4 输出 | named pages 需较新内核（Chrome 85+ / Safari 16+ / Firefox 133+），旧内核退化统一纸张 |
| iOS App 内打印无效 | WKWebView 限制——引导用户走"分享 → 打印"或导出 PDF |
| 字体首载后失效 | PDF 字体走 IndexedDB 缓存（15s 超时回退内置西文字体），清理站点数据后重新拉取 |

</details>

<details>
<summary><b>🏗️ 架构与质量门禁</b></summary>

```
MachReport（pnpm monorepo · TS strict · 单 npm 包）
├── packages/
│   ├── mach-report/                  # 唯一发布包（零运行时依赖，ESM+CJS）
│   │   └── src/
│   │       ├── layout/  render/  schema/  builder/  compat/  format.ts   # 引擎核心
│   │       └── pdf/  sql/  manager/  xlsx/  vue/    # 子路径域（重依赖/框架按需隔离）
│   └── federation/                   # 模块联邦远程入口（部署产物，不发 npm）
├── examples/                         # minimal 演示 + fed-host 联邦宿主实证
├── e2e/  docs/  assets/
```

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm exec playwright test
# TS strict(含 vue-tsc) · ESLint 0 错 0 警 · 全量单测(纯逻辑 node 环境分流) · 真 Chromium E2E(0 重试) · 七入口构建
```

关键设计决策：单真相源渲染 / 单包子路径架构 / 自引用复用 / 三后端共享几何与样式解析 / 性能预算门禁 / 变更日志（changesets）。

</details>

## 📚 文档

- [docs/PROGRESS.md](docs/PROGRESS.md) —— 十一轮迭代日志与决策记录
- [docs/API.md](docs/API.md) —— 接入速查（props / 配置中心 / 数据面 / DSL）
- [docs/reverse-findings.md](docs/reverse-findings.md) —— jh4j 逆向结论
- [AGENTS.md](AGENTS.md) —— 仓库协作指南（命令 / 架构 / 发布流程）

## 🧭 路线图

- ✅ v1.0：单包架构 · 报表语义四件套 · 参数面板 · 交互完整面 · 双远端 + npm 定版
- 🚧 设计器画布（拖拽 / 属性面板 / 撤销栈）——独立立项
- 🚧 管理端控制台 UI（`./manager` API 已就绪）——独立立项
- 🔭 交叉表 / 公式列 ——按真实需求排期

---

<div align="center">

**Mach 家族**：[MachTable](https://www.npmjs.com/package/@agile-team/mach-table)（数据表格）→ **MachReport**（打印报表）

Source-available © ChenyCHENYU (Agile Team). 使用需事先取得书面授权，详见 [LICENSE](LICENSE)。

</div>
