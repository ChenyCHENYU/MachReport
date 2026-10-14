<p align="center">
  <img src="./assets/mach-report-logo.svg" alt="MachReport Paginated Report Engine" width="920" />
</p>

<p align="center">
  <strong>面向业务单据、明细台账与打印场景的 TypeScript 报表引擎</strong><br />
  框架无关内核 · 毫米级页面模型 · Vue 3 预览 · PDF / Excel 输出
</p>

<p align="center">
  <img src="https://img.shields.io/badge/source-2.0.0-2563eb" alt="Source version 2.0.0" />
  <a href="https://www.npmjs.com/package/@agile-team/mach-report"><img src="https://img.shields.io/npm/v/@agile-team/mach-report?label=npm&color=3178c6" alt="npm version" /></a>
  <a href="https://github.com/ChenyCHENYU/MachReport/actions/workflows/ci.yml"><img src="https://github.com/ChenyCHENYU/MachReport/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-authorization%20required-dc2626" alt="Authorization required" /></a>
  <img src="https://img.shields.io/badge/core%20runtime%20dependencies-0-14b8a6" alt="Zero core runtime dependencies" />
  <img src="https://img.shields.io/badge/TypeScript-first-6366f1" alt="TypeScript first" />
</p>

<p align="center">
  <a href="#60-秒开始"><strong>快速开始</strong></a> ·
  <a href="#excel-报表能力与边界"><strong>Excel 能力</strong></a> ·
  <a href="#接入项目数据">数据接入</a> ·
  <a href="#按需加载与包边界">按需入口</a> ·
  <a href="./docs/API.md">API</a> ·
  <a href="./examples">示例</a> ·
  <a href="./LICENSING.md">授权说明</a>
</p>

---

## 为什么选择 MachReport

MachReport 把模板、数据和输出分开：用 TypeScript DSL 或 JSON 定义纸张与内容，由分页引擎生成统一的 `RenderPlan`，再交给预览、打印或文件导出。适合出入库单、工艺卡、订单明细和分组汇总等需要明确纸张尺寸与分页的业务场景。

| 维度 | 已具备的能力 |
| --- | --- |
| 页面模型 | 毫米单位、纸张预设与自定义尺寸、页边距、横纵向、文本与表格几何 |
| 明细与汇总 | 自动折行与分页、重复表头、连续分组小计、末尾总计、页码占位符 |
| 数据呈现 | 数值 / 百分比 / 日期格式化、声明式条件格式、可注入文本测量器 |
| 预览交互 | Vue 3 DOM 预览、页级虚拟化、缩放与适宽、搜索定位、缩略图、参数面板 |
| 输出 | 浏览器打印、HTML、PDF、真正的 `.xlsx`、逐页 PNG、Word 兼容 HTML `.doc` |
| 工程接入 | 局部组件、全局插件、异步入口、分层配置、结构化错误与导出告警 |
| 引擎复用 | 框架无关的分页与校验、DOM / Canvas 渲染；PDF / XLSX 可用于 Node.js |

数据接口、鉴权、查询与业务规则由宿主应用决定；`PlanFetcher` 只负责返回渲染计划。可视化拖拽设计器与报表管理控制台尚未提供。

## 安装：一个包，按需入口

```bash
pnpm add @agile-team/mach-report
```

Vue 组件要求 Vue `^3.2.0`；主题样式在应用入口引入一次。只使用引擎、PDF 或 XLSX 时，Vue 是可选的，无需导入 `/vue`。发布包声明的 Node.js 要求为 `>=18.0.0`；仓库开发环境要求见[本地开发与验证](#本地开发与验证)。

## 60 秒开始

### Vue 3：本地模板与明细

```vue
<script setup lang="ts">
import { createTemplate } from "@agile-team/mach-report";
import { createLocalFetcher, ReportPreview } from "@agile-team/mach-report/vue";
import "@agile-team/mach-report/vue/style.css";

const template = createTemplate()
  .page("a4")
  .text("产品出库单", { leftMm: 12, topMm: 12, widthMm: 186, heightMm: 10 },
    { bold: true, fontSize: 16, align: "center" })
  .list("detail", { leftMm: 12, topMm: 30, widthMm: 186 }, [
    { header: "物料", field: "name", widthMm: 120 },
    { header: "数量", field: "qty", widthMm: 66, style: { align: "right" } }
  ])
  .build();

const fetcher = createLocalFetcher({
  outbound: { template, datasets: { detail: [{ name: "物料 A", qty: 3 }] } }
});
</script>

<template>
  <ReportPreview report-id="outbound" :fetcher="fetcher" height="70vh" />
</template>
```

全局接入时，在应用入口调用 `app.use(machReportPlugin, { fetcher })`，页面使用 `<MachReportPreview report-id="outbound" />`。查询参数应在业务 `PlanFetcher` 中参与取数；`createLocalFetcher` 仅按报表 ID 读取已提供的模板与数据集。

### 原生 TypeScript：生成并渲染页面

```ts
import { createTemplate, paginateTemplate, renderPlan } from "@agile-team/mach-report";

const template = createTemplate()
  .page("a4")
  .text("第一张报表", { leftMm: 20, topMm: 20, widthMm: 100, heightMm: 10 })
  .build();

const { plan, warnings } = paginateTemplate(template, {});
if (warnings.length > 0) console.warn(warnings);

// 页面中提供 <div id="report"></div>。
document.querySelector("#report")!.replaceChildren(renderPlan(plan, document));
```

`paginateTemplate` 可在客户端或服务端运行。`renderPlan` 需要 DOM；Canvas、图片与浏览器打印同样需要浏览器环境。大量页面使用页窗口或 Vue 预览组件，避免一次创建全部页面节点。

## Excel 报表能力与边界

**支持生成真正的 Excel `.xlsx` 工作簿。** Vue 工具栏提供「导出 Excel」，组件控制器支持 `exportAs("xlsx")` / `exportAs("excel")`；原生与 Node.js 可从 `/xlsx` 使用 `renderPlanToXlsx`。

```ts
import { writeFile } from "node:fs/promises";
import { renderPlanToXlsx } from "@agile-team/mach-report/xlsx";

// plan 是 paginateTemplate 或业务接口生成的 RenderPlan。
const { buffer, warnings } = await renderPlanToXlsx(plan, {
  sheetName: (pageIndex) => `报表${pageIndex + 1}`
});
if (warnings.length > 0) console.warn(warnings);
await writeFile("report.xlsx", new Uint8Array(buffer));
```

| 项目 | 当前行为 |
| --- | --- |
| 工作簿结构 | 每个报表页生成一张工作表，默认 `Sheet1`、`Sheet2`…，可自定义名称 |
| 表格结构 | 表头、明细、小计 / 总计的渲染结果，列宽、行高、跨行 / 跨列合并 |
| 基础样式 | 字号、加粗、文字颜色、水平对齐、单元格底色与细边框 |
| 标题文本 | 按组件顺序写入合并行；页面绝对坐标转换为工作表行流 |
| 单元格类型 | 当前写入渲染后的文本，数字与日期不保留原始 Excel 类型或公式 |
| 非表格内容 | 图片、条码、二维码、图表、嵌套组件和无文本回退的富文本等暂不导出，跳过时返回 `warnings` |
| 版式与打印 | 基础 A4 打印设置；不保证复制 PDF 的坐标、纸张与全部样式 |
| Excel 编辑工作流 | 尚无 `.xlsx` 模板导入、交互式工作簿编辑、公式计算或透视表 API |

这条输出链适合把已生成的报表转为可打开、可编辑的 Excel 表格。需要保留数值 / 日期类型、公式或自定义工作簿布局时，可使用返回的 ExcelJS `workbook` 继续处理并重新序列化，或建立独立的业务数据导出流程。

完整示例、类型保留策略和注意事项见 [Excel 导出指南](./docs/EXCEL.md)。

## 一份清晰的应用配置

把通用文案、主题、页间距和 PDF 字体放入配置中心；具体数据源与报表参数由实例提供。

```ts
import { defineMachReportConfig, machReportPlugin } from "@agile-team/mach-report/vue";

const config = defineMachReportConfig({
  defaults: {
    gapPx: 18,
    pdfFontUrl: "/fonts/NotoSansSC-Regular.ttf",
    messages: { title: "业务报表" }
  },
  presets: {
    previewOnly: { showExport: false, showPrint: false, showPdfWindow: false }
  }
});

app.use(machReportPlugin, { fetcher, config });
```

优先级为：内置值 → 应用 defaults → 命名 preset → 组件属性；路由级 `provideMachReportConfig` 会叠加应用配置。中文 PDF 需要部署覆盖所用字符的字体并配置 `pdfFontUrl`；Vue 出口遇到缺字或页面渲染错误会阻止下载。`.doc` 出口是 Word 兼容的 HTML 文档，并非 `.docx`。

## 接入项目数据

**后端可以只提供业务数据。** 前端定义模板与字段映射，再调用 `paginateTemplate(template, datasets)`，即可生成用于预览、打印和导出的 `RenderPlan`。后端无需安装 MachReport，也不必实现专用报表服务；模板也可以由后端存储后返回。

| 接入模式 | 后端返回 | 前端负责 |
| --- | --- | --- |
| 业务数据模式（常规项目优先） | 业务 JSON，如单据明细、查询结果 | 获取模板、映射字段、分页、预览和导出 |
| 渲染计划模式 | 符合协议的 `RenderPlan` JSON | 校验计划、预览和导出 |

内核、PDF 和 XLSX 出口不依赖前端框架；**现成的 `ReportPreview`、工具栏和参数面板依赖 Vue 3**。React、Angular 或原生 JavaScript 项目可调用核心 DOM / Canvas API 和导出 API，自行封装界面与生命周期。框架无关不代表各框架都已有预览组件。

Vue 接入通过 `PlanFetcher` 适配两种模式。它最终必须返回 `RenderPlan`，不能直接返回普通业务数组。业务数据模式的完整示例见 [API：后端只提供业务数据](./docs/API.md#后端只提供业务数据)。接口路径、请求库、鉴权和响应映射由宿主项目管理。

如果已有接口直接返回渲染计划：

```ts
import { validateRenderPlan, type RenderPlan } from "@agile-team/mach-report";
import type { PlanFetcher } from "@agile-team/mach-report/vue";

const fetcher: PlanFetcher = async ({ reportIds, params }) => {
  const response = await fetch("/api/report-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportIds, params })
  });
  if (!response.ok) throw new Error(`报表加载失败：HTTP ${response.status}`);
  const plan = (await response.json()) as RenderPlan;
  const result = validateRenderPlan(plan);
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "报表格式错误");
  return plan;
};
```

`/api/report-plan` 是示例路径，请替换为实际接口。参数面板通过 `paramDefs` 声明，查询时将参数传给 fetcher。`report-id` 用于选择报表定义，业务单据 ID 可放在 `params` 中；具体映射由应用定义。`createLocalFetcher` 使用已提供的模板与数据，不会自动请求后端。

```text
模板 + 数据 ── paginateTemplate ──┐
                                  ├─ RenderPlan ─┬─ Vue / DOM / Canvas
项目数据接口 ── PlanFetcher ──────┘              ├─ 浏览器打印 / HTML
                                                 └─ PDF / XLSX / 图片 / Word 兼容文档
```

## 按需加载与包边界

| 入口 | 用途 |
| --- | --- |
| `@agile-team/mach-report` | 模板 DSL、分页、格式化、计划校验、DOM / Canvas、页窗口计算 |
| `@agile-team/mach-report/vue` | Vue 组件、插件、配置中心、本地 / 请求适配器、控制器类型 |
| `@agile-team/mach-report/vue/async` | 异步全局组件插件与 `preloadMachReport` 预取 |
| `@agile-team/mach-report/vue/style.css` | Vue 预览样式 |
| `@agile-team/mach-report/pdf` | `renderPlanToPdf`、字体加载与缓存 |
| `@agile-team/mach-report/xlsx` | `renderPlanToXlsx`、工作簿与导出告警 |
| `@agile-team/mach-report/sql` | 动态 SQL 编译与单 SELECT 校验工具 |

内核保持零运行时依赖；ExcelJS、pdf-lib / fontkit、SQL parser 分别内联于对应构建入口。导入 `/xlsx` 才使用 Excel 能力，导入 `/pdf` 才使用 PDF 能力；Vue 不进入引擎主入口。npm 构建提供 ESM、CommonJS 与类型声明。

XLSX 的完整 Workbook 类型随声明打包，`@types/node` 为其 stream API 提供类型。Canvas / PNG 当前适合文本、表格和基础形状，图片型组件的绘制仍待完善；对输出保真度敏感时，请按具体组件验证 DOM 与 PDF 结果。

需要远程加载组件的项目，可部署 `packages/federation`，参考[模块联邦示例](./examples/fed-host)。普通 Vue 项目直接使用 npm 子入口。

## 本地开发与验证

仓库开发要求 Node.js `>=22.13.0`、pnpm `11.8.0`。运行以下命令建立本地质量基线：

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm test:e2e
```

| 命令 | 用途 |
| --- | --- |
| `pnpm typecheck` | TypeScript 项目与 Vue SFC 类型检查 |
| `pnpm lint` | ESLint 检查 |
| `pnpm test` / `pnpm test:coverage` | Vitest 单元测试 / 覆盖率 |
| `pnpm build` | 引擎、Vue、联邦与示例构建 |
| `pnpm verify` | 类型、Lint、构建、覆盖率、文档与打包消费端校验 |
| `pnpm check:consumer` | npm 产物在隔离目录的 ESM / CJS 运行与类型验证 |
| `pnpm test:e2e` | Playwright 浏览器端到端验证 |
| `pnpm --filter @agile-team/example-minimal dev` | 启动本地报表示例 |

CI 使用同一套校验命令，并在构建后检查实际发布产物。协作边界、Changesets 与发布流程见 [AGENTS.md](./AGENTS.md)。

最小示例已包含覆盖示例字符的中文 PDF 字体子集，来源和 OFL 授权见[字体说明](./examples/minimal/public/fonts/README.md)。生产报表请配置覆盖实际数据的完整字体。

## 文档地图

| 目标 | 入口 |
| --- | --- |
| 接入与 API | [API 速查](./docs/API.md)：数据模型、模板、Vue 属性 / 事件、配置与导出 |
| Excel | [导出指南](./docs/EXCEL.md)：能力边界、Node 示例与原始数据类型 |
| 本地报表 | [最小示例](./examples/minimal)：出库单、工艺卡、多页与多模板预览 |
| 远程组件 | [模块联邦示例](./examples/fed-host) · [部署包](./packages/federation) |
| 排版与字体 | [字体测量与校准](./docs/font-calibration.md) |
| 版本记录 | [Changelog](./packages/mach-report/CHANGELOG.md) |
| 工程协作 | [AGENTS.md](./AGENTS.md) |
| 产品演进 | [项目评审与优化优先级](./docs/PROJECT_REVIEW.md) |
| 使用授权 | [许可证](./LICENSE) · [授权说明](./LICENSING.md) |

## 版本与授权

当前源码版本为 `2.0.0`，以 [`packages/mach-report/package.json`](./packages/mach-report/package.json) 为准；npm 已发布版本由顶部 npm 标识展示。

Copyright © 2026 ChenyCHENYU (Agile Team). All rights reserved.

MachReport 采用 [MachReport Source-Available License 1.0](./LICENSE)。源码公开可供查看，使用、运行、测试、修改、集成、部署、分发或商业使用须事先取得作者书面授权。申请流程见[授权说明](./LICENSING.md)。

问题与建议请通过 [GitHub Issues](https://github.com/ChenyCHENYU/MachReport/issues) 提交。
