<div align="center">

# 📊 MachReport

**独立的 TypeScript 报表引擎与 Vue 3 预览组件**

用自己的模板和数据生成报表，或接入项目已有的报表数据接口；统一预览、打印与导出。

[![npm](https://img.shields.io/npm/v/@agile-team/mach-report.svg)](https://www.npmjs.com/package/@agile-team/mach-report)
[![CI](https://github.com/ChenyCHENYU/MachReport/actions/workflows/ci.yml/badge.svg)](https://github.com/ChenyCHENYU/MachReport/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-2455a6)](https://www.npmjs.com/package/@agile-team/mach-report)

[快速开始](#快速开始) · [接入项目数据](#接入项目数据) · [能力一览](#能力一览) · [文档](#文档)

</div>

## MachReport 做什么

| 环节 | 能力 |
| --- | --- |
| 定义报表 | TypeScript 模板 DSL 或 JSON 模板，支持明细、分组、总计和分页 |
| 提供数据 | 本地数据集，或由项目实现 `PlanFetcher` 返回 `RenderPlan` |
| 展示与交互 | Vue 3 预览组件、缩放、搜索、缩略图、参数面板、页级虚拟化 |
| 输出 | 浏览器打印、PDF、XLSX、逐页图片、Word 兼容文档 |

MachReport 不预设网关地址、鉴权方式或报表服务。组件只通过 `fetcher` 获取项目的渲染计划。

## 快速开始

**1. 安装**

```bash
pnpm add @agile-team/mach-report
```

**2. 用本地模板注册数据源**

```ts
// main.ts
import { createApp } from "vue";
import App from "./App.vue";
import { createTemplate } from "@agile-team/mach-report";
import { createLocalFetcher, machReportPlugin } from "@agile-team/mach-report/vue";
import "@agile-team/mach-report/vue/style.css";

const template = createTemplate()
  .page("a4")
  .text("第一张报表", { leftMm: 20, topMm: 20, widthMm: 100, heightMm: 10 })
  .build();

const fetcher = createLocalFetcher({ demo: { template } });
const app = createApp(App);
app.use(machReportPlugin, { fetcher });
app.mount("#app");
```

**3. 在页面中预览**

```vue
<template>
  <MachReportPreview report-id="demo" height="70vh" />
</template>
```

使用 Vue 组件需要 Vue 3。只使用引擎或 Node.js 导出时，无需导入 `/vue` 子路径。

## 接入项目数据

项目已有接口时，实现一个 `PlanFetcher`，返回 MachReport 的 `RenderPlan`。接口路径、请求库、鉴权和数据映射都由项目决定：

```ts
import type { RenderPlan } from "@agile-team/mach-report";
import type { PlanFetcher } from "@agile-team/mach-report/vue";

const fetcher: PlanFetcher = async ({ reportIds, params }) => {
  const response = await fetch("/api/report-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportIds, params })
  });
  if (!response.ok) throw new Error(`报表加载失败：HTTP ${response.status}`);
  return (await response.json()) as RenderPlan;
};

// 在 main.ts 中替换本地 fetcher 的注册；也可传给单个 ReportPreview。
app.use(machReportPlugin, { fetcher });
```

`/api/report-plan` 是示例路径，请替换为项目接口。需要从现有业务数据生成 `RenderPlan` 时，可在客户端或服务端调用 `paginateTemplate(template, datasets)`；[API 文档](https://github.com/ChenyCHENYU/MachReport/blob/main/docs/API.md)给出完整类型与示例。

```text
模板 + 数据 ── paginateTemplate ──┐
                                  ├─ RenderPlan ─┬─ 预览 / 打印
项目数据接口 ── 自定义 PlanFetcher ┘              ├─ PDF / XLSX
                                                 └─ 图片 / Word 兼容文档
```

## 能力一览

| 领域 | 已提供 |
| --- | --- |
| 报表语义 | 明细分页、分组小计、总计、页码占位符、列格式化、条件格式 |
| 预览 | DOM / Canvas、页级虚拟化、缩放、搜索、缩略图、参数面板 |
| 导出 | PDF、真正的 `.xlsx`、PNG / JPEG、Word 兼容 HTML `.doc`、逐页打印 |
| 工程接入 | Vue 插件或局部组件、自定义数据源、结构化错误、导出进度与告警 |
| 按需入口 | `/vue`、`/pdf`、`/xlsx`、`/sql`；主入口为框架无关的引擎 |

中文 PDF 需配置包含所用汉字的字体 `pdfFontUrl`；缺字时导出会报错。XLSX 保留表格数据与结构，不承诺 PDF 式像素排版；`.doc` 是 Word 可打开的 HTML 文档，并非 `.docx`。

## 文档

| 入口 | 内容 |
| --- | --- |
| [API 速查](https://github.com/ChenyCHENYU/MachReport/blob/main/docs/API.md) | `RenderPlan`、模板 DSL、Vue 属性与事件、配置、导出 |
| [最小示例](https://github.com/ChenyCHENYU/MachReport/tree/main/examples/minimal) | 本地报表、多页预览与交互 |
| [模块联邦示例](https://github.com/ChenyCHENYU/MachReport/tree/main/examples/fed-host) | 远程加载报表组件 |

## 本地开发

需要 Node.js ≥ 18 和 pnpm ≥ 11。

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec playwright test
```

发布与协作约定见 [AGENTS.md](https://github.com/ChenyCHENYU/MachReport/blob/main/AGENTS.md)。

## 许可

Source-available © ChenyCHENYU (Agile Team)。使用需事先取得书面授权，详见 [LICENSE](https://github.com/ChenyCHENYU/MachReport/blob/main/LICENSE)。
