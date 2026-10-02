<div align="center">

<img src="https://raw.githubusercontent.com/ChenyCHENYU/MachReport/main/assets/mach-report-icon.svg" alt="MachReport 图标" width="72" height="72" />

# MachReport

**面向打印报表的 TypeScript 引擎与 Vue 3 预览组件**

接入现有 jh4j `gridPlan`，或用本地模板生成报表；共用一份 RenderPlan 输出预览、PDF、Excel 和打印。

[![npm](https://img.shields.io/npm/v/@agile-team/mach-report.svg)](https://www.npmjs.com/package/@agile-team/mach-report)
[![CI](https://github.com/ChenyCHENYU/MachReport/actions/workflows/ci.yml/badge.svg)](https://github.com/ChenyCHENYU/MachReport/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-2455a6)](https://www.npmjs.com/package/@agile-team/mach-report)

[快速开始](#快速开始) · [接入方式](#接入方式) · [能力一览](#能力一览) · [使用边界](#使用边界) · [文档导航](#文档导航)

</div>

## 适合用在哪里

| 场景 | 用法 |
| --- | --- |
| 已有 jh4j 报表服务，需要在 Vue 页面预览和打印 | 传入已发布的 `tempId`，复用现有 `gridPlan` 接口 |
| 报表数据在前端或自有服务中 | 用模板 DSL / JSON 分页，或传入自定义 `PlanFetcher` |
| 定时归档、邮件附件等服务端任务 | 在 Node.js 中按需导入 PDF / XLSX 子路径 |

MachReport 提供渲染引擎和接入组件；目录、数据源、可视设计、权限与发布流程仍由现有报表平台负责。具体 jh4j 模板的版式需要逐张验收，见[对标与验收记录](https://github.com/ChenyCHENYU/MachReport/blob/main/docs/comparison-and-acceptance.md)。

## 快速开始

**1. 安装**

```bash
pnpm add @agile-team/mach-report
```

使用 Vue 组件时，宿主项目需要 Vue 3；只用引擎或 Node.js 导出时无需引入 Vue 子路径。

**2. 注册插件**（同源部署，浏览器请求已带鉴权）

```ts
// main.ts
import { createApp } from "vue";
import App from "./App.vue";
import { machReportPlugin } from "@agile-team/mach-report/vue";
import "@agile-team/mach-report/vue/style.css";

const app = createApp(App);
app.use(machReportPlugin);
app.mount("#app");
```

**3. 在业务页使用已发布的报表 ID**

```vue
<template>
  <MachReportPreview
    temp-id="CK_TEMPLATE_001"
    :params="{ id: '9' }"
    height="70vh"
  />
</template>
```

插件默认请求同源 `/report/codePrintReport/gridPlan`。如果宿主通过请求拦截器加 token，或有网关前缀，把第 2 步的 `app.use(machReportPlugin)` 替换为：

```ts
import request from "@/utils/request"; // 宿主项目现有请求客户端

app.use(machReportPlugin, {
  request,
  baseUrl: "/sub/mach-report",
  pdfFontUrl: "/fonts/NotoSansSC-Regular.ttf"
});
```

其中 `request` 是宿主已有的 Axios 风格客户端。中文 PDF 需部署包含所用汉字的字体；缺字时导出会报错，避免下载残缺文件。

## 接入方式

| 需要的数据来源 | 选择 | 入口 |
| --- | --- | --- |
| 同源 jh4j 服务 | 插件默认 fetch | `@agile-team/mach-report/vue` |
| 宿主网关、鉴权拦截器 | 插件传 `request` / `baseUrl` | `machReportPlugin` |
| 本地模板与数据 | `createLocalFetcher` | `@agile-team/mach-report/vue` |
| 自有服务已生成 RenderPlan | 实现 `PlanFetcher` | `@agile-team/mach-report/vue` |
| 不使用 Vue | 模板、渲染与导出函数 | 主入口及 `/pdf`、`/xlsx` 子路径 |

完整的参数、事件、插槽、局部导入和异步入口示例见 [API 文档](https://github.com/ChenyCHENYU/MachReport/blob/main/docs/API.md)。

## 能力一览

| 环节 | 已提供的能力 |
| --- | --- |
| 输入与分页 | jh4j `gridPlan`；本地 DSL / JSON；明细分页、分组小计、总计、页码、条件格式 |
| 预览 | DOM / Canvas、页级虚拟化、缩放、搜索、缩略图、参数面板 |
| 输出 | 浏览器打印、前端 PDF、真正的 `.xlsx`、逐页 PNG / JPEG、Word 兼容 HTML `.doc` |
| 接入与诊断 | Vue 插件、自定义数据获取器、结构化错误、导出进度与保真告警 |
| 扩展入口 | Node.js PDF / XLSX 导出、动态 SQL 工具、报表管理 API 客户端 |

```text
本地模板 + 数据 ── 分页 ──┐
                         ├─ RenderPlan ─┬─ 预览 / 打印
jh4j gridPlan ────────────┘              ├─ PDF / Excel
                                        └─ 图片 / Word 兼容文档
```

包按子路径拆分：`/vue`、`/pdf`、`/xlsx`、`/sql`、`/manager` 按需导入。主入口只包含框架无关的引擎能力。

## 使用边界

- **真实模板保真**：富文本、图片类组件和子报表的存量模板导入可能降级；应以同一业务单据的 jh4j PDF 为基准，逐张检查跨页、合并单元格、字体和打印。
- **导出格式**：XLSX 保留表格数据与结构，不承诺 PDF 式像素排版；`.doc` 是 Word 可打开的 HTML 文档，并非 `.docx`。
- **性能结论**：仓库里的性能测试是内部回归门槛。与其他报表产品比较，应使用同一模板、数据和环境进行端到端测量。
- **真实环境验证**：当前仓库缺少已脱敏的真实 `gridPlan` 样本，相关契约测试会跳过；采集和验收步骤见[验收记录](https://github.com/ChenyCHENYU/MachReport/blob/main/docs/comparison-and-acceptance.md)。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [API 速查](https://github.com/ChenyCHENYU/MachReport/blob/main/docs/API.md) | Vue 属性 / 事件、配置中心、模板 DSL、导出与管理 API |
| [对标与验收记录](https://github.com/ChenyCHENYU/MachReport/blob/main/docs/comparison-and-acceptance.md) | 与 jh4j / FineReport 的范围对比、真实模板验收方法 |
| [最小示例](https://github.com/ChenyCHENYU/MachReport/tree/main/examples/minimal) | Vue 接入与预览交互 |
| [进展记录](https://github.com/ChenyCHENYU/MachReport/blob/main/docs/PROGRESS.md) | 已实现变更与验证记录 |

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

工作区包含唯一发布包 `packages/mach-report`、模块联邦部署件和示例应用。发布流程与协作约定见 [AGENTS.md](https://github.com/ChenyCHENYU/MachReport/blob/main/AGENTS.md)。

## 许可

Source-available © ChenyCHENYU (Agile Team)。使用需事先取得书面授权，详见 [LICENSE](https://github.com/ChenyCHENYU/MachReport/blob/main/LICENSE)。
