<p align="center">
  <img src="./assets/mach-report-logo.svg" alt="MachReport Paginated Report Engine" width="920" />
</p>

<p align="center">
  <strong>面向业务单据、明细台账与打印场景的 TypeScript 报表引擎</strong><br />
  框架无关内核 · 毫米级页面模型 · Vue 3 预览 · PDF / Excel 输出
</p>

<p align="center">
  <img src="https://img.shields.io/badge/source-2.2.0-2563eb" alt="Source version 2.2.0" />
  <a href="https://www.npmjs.com/package/@agile-team/mach-report"><img src="https://img.shields.io/npm/v/@agile-team/mach-report?label=npm&color=3178c6" alt="npm version" /></a>
  <a href="https://github.com/ChenyCHENYU/MachReport/actions/workflows/ci.yml"><img src="https://github.com/ChenyCHENYU/MachReport/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-authorization%20required-dc2626" alt="Authorization required" /></a>
  <img src="https://img.shields.io/badge/core%20runtime%20dependencies-0-14b8a6" alt="Zero core runtime dependencies" />
  <img src="https://img.shields.io/badge/TypeScript-first-6366f1" alt="TypeScript first" />
</p>

<p align="center">
  <a href="#60-秒开始"><strong>快速开始</strong></a> ·
  <a href="#excel-报表能力与边界"><strong>Excel 能力</strong></a> ·
  <a href="#对齐与可读性">对齐配置</a> ·
  <a href="#模板配置与管理扩展">模板管理</a> ·
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
| 数据呈现 | 表头与内容独立对齐、类型自动对齐、数值 / 百分比 / 日期格式化、条件格式 |
| 预览交互 | 正文与缩略图双窗口渲染、缩放与适宽、可取消分片搜索、参数面板 |
| 模板配置 | 版本化 JSON 文档、导入导出校验、模板目录、异步加载与取消 |
| 输出 | 浏览器打印、HTML、PDF、真正的 `.xlsx`、逐页 PNG、Word 兼容 HTML `.doc` |
| 工程接入 | 局部组件、全局插件、异步入口、分层配置、结构化错误与导出告警 |
| 引擎复用 | 框架无关的分页与校验、DOM / Canvas 渲染；PDF / XLSX 可用于 Node.js |

数据接口、鉴权、查询与业务规则由宿主应用决定。模板管理提供可直接连接文件或后台接口的文档与目录 API；可视化设计器、管理页面、审批与持久化由宿主扩展。

## 安装：一个包，按需入口

```bash
pnpm add @agile-team/mach-report
```

Vue 组件要求 Vue `^3.2.0`；主题样式在应用入口引入一次。只使用引擎、PDF 或 XLSX 时，Vue 是可选的，无需导入 `/vue`。发布包声明的 Node.js 要求为 `>=18.0.0`；仓库开发环境要求见[本地开发与验证](#本地开发与验证)。

## 60 秒开始

### Vue 3：本地模板与明细

```vue
<script setup lang="ts">
import { createTableTemplate, createLocalFetcher, ReportPreview } from "@agile-team/mach-report/vue";
import "@agile-team/mach-report/vue/style.css";

const template = createTableTemplate({
  title: "产品出库单",
  columns: [
    { header: "物料", field: "name", flex: 2 },
    { header: "数量", field: "qty" }
  ]
});

const fetcher = createLocalFetcher({
  outbound: { template, datasets: { detail: [{ name: "物料 A", qty: 3 }] } }
});
</script>

<template>
  <ReportPreview report-id="outbound" :fetcher="fetcher" height="70vh" />
</template>
```

标准明细只定义标题和列：默认 A4、10 mm 页边距、`detail` 数据集、表头居中，按内容类型对齐，自动分配列宽并分页。支持固定列宽、权重、横向纸张、分组与总计；复杂单据继续使用 `createTemplate()` 自由排版。

### 项目接入：注册一次，页面只传 ID 和参数

模板与业务取数集中注册，分页、校验、参数面板、多报表合并及请求生命周期交给包内处理。Vue 用户从同一个 `/vue` 入口获取组件和核心能力。

```ts
import { machReportPlugin, defineReport } from "@agile-team/mach-report/vue";
import "@agile-team/mach-report/vue/style.css";

app.use(machReportPlugin, {
  reports: {
    outbound: defineReport({
      template,
      load: ({ params, signal }) => orderApi.report(params, { signal }),
      mapData: (data) => ({ detail: data.items })
    })
  }
});
```

```vue
<MachReportPreview report-id="outbound" :params="{ orderId }" height="70vh" />
```

`template` 使用上例或项目自己的模板；`orderApi` 是项目现有业务请求客户端。接口已经返回数据集时，直接写 `load: ({ params, signal }) => reportApi(params, { signal })`，无需 `defineReport` 或字段映射。静态数据使用 `{ template, datasets }`。

模板的 `params` 会自动生成查询面板，显式 `paramDefs` 可覆盖。父页面用 `useMachReport()` 获得 `ref`、可等待的控制方法和只读响应式 `state`；例如 `report.state.canExport` 直接驱动外部按钮，加载、页数、导出、打印与错误无需另建状态。完整示例及接入边界见[项目接入指南](./docs/INTEGRATION.md)。旧 `fetcher` 与 `createLocalFetcher` 继续支持。

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
  valueMode: "raw",
  sheetName: (pageIndex) => `报表${pageIndex + 1}`
});
if (warnings.length > 0) console.warn(warnings);
await writeFile("report.xlsx", new Uint8Array(buffer));
```

| 项目 | 当前行为 |
| --- | --- |
| 工作簿结构 | 每个报表页生成一张工作表，默认 `Sheet1`、`Sheet2`…，可自定义名称 |
| 表格结构 | 表头、明细、小计 / 总计的渲染结果，列宽、行高、跨行 / 跨列合并 |
| 基础样式 | 字号、字体族、加粗 / 斜体 / 下划线、颜色、水平 / 垂直对齐、换行、底色与边框开关 |
| 标题文本 | 按组件顺序写入合并行；页面绝对坐标转换为工作表行流 |
| 单元格类型 | 默认 `text` 保留显示文本；`raw` 保留列表原始数值、布尔、文本编号、空值和汇总数值 |
| 数字格式 | `raw` 模式沿用小数位、千分位和百分比格式，不猜测文本编号的类型 |
| 非表格内容 | 图片、条码、二维码、图表、嵌套组件和无文本回退的富文本等暂不导出，跳过时返回 `warnings` |
| 版式与打印 | 自动识别 A3 / A4 / A5，可配置 `paperSize`；自定义尺寸回退有告警，绝对坐标仍转为行流 |
| Excel 编辑工作流 | 尚无 `.xlsx` 模板导入、交互式工作簿编辑、公式计算或透视表 API |

列表自动保留原始值，Vue 可在配置中一次启用 `xlsx: { valueMode: "raw" }`；旧计划没有原始值时继续导出显示文本。日期对象、公式和自定义布局仍需业务明确处理。Excel 不做 PDF 坐标复刻；可使用返回的 ExcelJS `workbook` 继续处理并重新序列化。

完整示例、类型保留策略和注意事项见 [Excel 导出指南](./docs/EXCEL.md)。

## 对齐与可读性

`createTableTemplate()` 提供适合业务报表的默认值，常规列无需逐个配置。表头和内容独立设置，整表配置可被单列覆盖。

| 内容 | 默认 / 建议 |
| --- | --- |
| 表头 | 标准明细默认居中；长说明列可单独居左 |
| 名称、描述、文本编号 | 居左；编码不会因长得像数字而自动变成数值 |
| 数量、金额、百分比 | 真实数字或明确指定数字格式时居右，便于比较位数 |
| 日期、布尔值 | 自动模式居中；字符串状态可显式设置 `align: "center"` |
| 统一业务要求 | `listOptions.align` / `headerAlign` 设置整表，列级配置优先 |

```ts
const template = createTableTemplate({
  columns: [
    { header: "物料名称", field: "name", flex: 2, headerAlign: "left" },
    { header: "数量", field: "qty", format: { kind: "number", digits: 3 } },
    { header: "状态", field: "status", align: "center" }
  ]
});
```

`align` 支持 `auto / left / center / right / justify`；`headerAlign` 支持四种明确对齐。`headerStyle` 可独立配置表头字体、底色与垂直对齐。条件规则只覆盖内容；旧低层模板未配置新字段时保留原有行为。DOM、Canvas、PDF 和 Excel 使用同一份解析后的样式。

## 模板配置与管理扩展

模板文档只保存布局与描述，可存为 JSON 文件或交给现有后台。模板 ID、名称、修订号和布局形成明确契约；查询接口、数据与鉴权继续使用项目已有能力。

```ts
import {
  defineReportTemplate, createTemplateRegistry,
  parseReportTemplate, serializeReportTemplate
} from "@agile-team/mach-report/vue";

const templates = createTemplateRegistry([
  defineReportTemplate({ id: "outbound", name: "产品出库单", revision: "1", template })
]);

// imported 是文件文本或后台返回的 JSON 对象；包内完成校验。
templates.register(parseReportTemplate(imported), { replace: true });
const json = serializeReportTemplate(templates.get("outbound")!);
```

`list / get / register / remove` 提供模板目录与独立快照；重复 ID 默认拒绝，更新显式声明替换。文档版本由 `defineReportTemplate` 自动补齐，未知版本、非法字段和非 JSON 内容会给出结构化校验错误。

远程管理只需让报表的 `template` 按需加载，页面写法保持不变：

```ts
app.use(machReportPlugin, {
  reports: {
    outbound: {
      template: async ({ reportId, signal }) =>
        parseReportTemplate(await templateApi.read(reportId, { signal })).template,
      load: ({ params, signal }) => reportApi.data(params, { signal })
    }
  }
});
```

动态模板不隐式缓存，每次重载读取当前版本；需要自动查询面板时，在报表定义中声明 `params`。管理后台可接入草稿、发布、版本历史与回滚，服务端负责权限和修订号冲突检查。完整方案见[模板管理扩展指南](./docs/TEMPLATE_MANAGEMENT.md)。

## 大报表预览与性能

正文和缩略图均按可见窗口渲染，离屏画布及时释放；页尺寸索引按计划建立一次，滚动和跳页通过二分定位。搜索按文本块分片，输入新查询、换单据或卸载会取消旧任务，命中计数按页保存，避免为每次重复文字创建一个记录。

默认已启用，无需额外接入代码。需要调节时，统一放入配置中心：

```ts
defineMachReportConfig({
  defaults: {
    preview: { overscanPages: 1, searchDebounceMs: 200 },
    xlsx: { valueMode: "raw", paperSize: "auto" }
  }
});
```

`overscanPages` 默认 1、限定 0–10；`searchDebounceMs` 默认 200、限定 0–2000 ms。应用、preset 与路由按字段继承。虚拟化控制渲染节点数量；完整数据仍需内存，首次分页和整本导出仍有计算成本。大业务范围应配合后端受控取数、日期范围和合理单元格内容，完整导出不能误用列表当前页数据。

## 一份清晰的应用配置

把通用文案、主题、页间距和 PDF 字体放入配置中心；具体数据源与报表参数由实例提供。

```ts
import { defineMachReportConfig, machReportPlugin } from "@agile-team/mach-report/vue";

const config = defineMachReportConfig({
  defaults: {
    gapPx: 18,
    pdfFontUrl: "/fonts/NotoSansSC-Regular.ttf",
    xlsx: { valueMode: "raw" },
    messages: { title: "业务报表" }
  },
  presets: {
    previewOnly: { showExport: false, showPrint: false, showPdfWindow: false }
  }
});

app.use(machReportPlugin, { fetcher, config });
```

优先级为：内置值 → 应用 defaults → 命名 preset → 组件属性；路由级 `provideMachReportConfig` 会叠加应用配置。中文 PDF 需要部署覆盖所用字符的字体并配置 `pdfFontUrl`；Vue 出口遇到缺字或页面渲染错误会阻止下载。`.doc` 出口是 Word 兼容的 HTML 文档，并非 `.docx`。

有效报表显示后，组件对已启用的 PDF 出口自动做轻量 HEAD 字体检查，不下载字库或加载 PDF 引擎。结果通过 `state.pdfFont` 提供，资源异常显示可重试提示；实际导出再验证字体文件及文字覆盖范围。部署、跨域与缓存处理见 [PDF 字体指南](./docs/PDF.md)。

## 接入项目数据

**后端可以只提供业务数据。** 宿主定义模板和取数函数，通过插件 `reports` 或核心 `createReportSource()` 注册；包内自动生成用于预览、打印和导出的 `RenderPlan`。后端无需安装 MachReport，也不必实现专用报表服务；模板也可以由后端存储后返回。

| 接入模式 | 后端返回 | 前端负责 |
| --- | --- | --- |
| 业务数据模式（常规项目优先） | 业务 JSON，如单据明细、查询结果 | 宿主提供模板、取数及字段映射；包内分页、校验、预览和导出 |
| 渲染计划模式 | 符合协议的 `RenderPlan` JSON | 宿主提供 fetcher；组件校验、预览和导出 |

内核、PDF 和 XLSX 出口不依赖前端框架；**现成的 `ReportPreview`、工具栏和参数面板依赖 Vue 3**。React、Angular 或原生 JavaScript 项目可调用核心 DOM / Canvas API 和导出 API，自行封装界面与生命周期。框架无关不代表各框架都已有预览组件。

常规业务接入使用上方的 `reports`，无需手写 `PlanFetcher` 或调用分页器。业务数据模式的完整示例见[项目接入指南](./docs/INTEGRATION.md)。接口路径、请求库、鉴权和字段映射由宿主项目管理。

如果已有接口直接返回渲染计划：

```ts
import type { RenderPlan, PlanFetcher } from "@agile-team/mach-report/vue";

const fetcher: PlanFetcher = async ({ reportIds, params, signal }) => {
  const response = await fetch("/api/report-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportIds, params }),
    signal
  });
  if (!response.ok) throw new Error(`报表加载失败：HTTP ${response.status}`);
  return (await response.json()) as RenderPlan; // 预览组件负责计划校验
};
```

`/api/report-plan` 是示例路径，请替换为实际接口。`PlanFetcher` 是高级逃生口，返回 `RenderPlan`，并可接收 `signal` 和 `onWarning`；旧函数可忽略新增可选参数。`report-id` 选择报表定义，业务单据 ID 放在 `params` 中。模板参数随 `reports` 自动传递，原始计划接口则可通过 `paramDefs` 声明查询面板。

```text
模板 + 数据 ── paginateTemplate ──┐
                                  ├─ RenderPlan ─┬─ Vue / DOM / Canvas
项目数据接口 ── PlanFetcher ──────┘              ├─ 浏览器打印 / HTML
                                                 └─ PDF / XLSX / 图片 / Word 兼容文档
```

## 按需加载与包边界

| 入口 | 用途 |
| --- | --- |
| `@agile-team/mach-report` | 模板 DSL、模板文档 / 目录、报表数据源、分页、格式化、计划校验、DOM / Canvas、页窗口计算 |
| `@agile-team/mach-report/vue` | 重导出核心 API；Vue 组件、插件、配置中心、适配器和父页面控制句柄 |
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
| 模板管理 | [扩展指南](./docs/TEMPLATE_MANAGEMENT.md)：JSON 文档、目录、动态版本与后台接入 |
| PDF | [字体与导出指南](./docs/PDF.md)：首次诊断、字库部署、缺字与缓存 |
| 本地报表 | [最小示例](./examples/minimal)：出库单、工艺卡、多页与多模板预览 |
| 远程组件 | [模块联邦示例](./examples/fed-host) · [部署包](./packages/federation) |
| 排版与字体 | [字体测量与校准](./docs/font-calibration.md) |
| 版本记录 | [Changelog](./packages/mach-report/CHANGELOG.md) |
| 工程协作 | [AGENTS.md](./AGENTS.md) |
| 产品演进 | [项目评审与优化优先级](./docs/PROJECT_REVIEW.md) |
| 使用授权 | [许可证](./LICENSE) · [授权说明](./LICENSING.md) |

## 版本与授权

当前源码版本为 `2.2.0`，以 [`packages/mach-report/package.json`](./packages/mach-report/package.json) 为准；npm 已发布版本由顶部 npm 标识展示。

Copyright © 2026 ChenyCHENYU (Agile Team). All rights reserved.

MachReport 采用 [MachReport Source-Available License 1.0](./LICENSE)。源码公开可供查看，使用、运行、测试、修改、集成、部署、分发或商业使用须事先取得作者书面授权。申请流程见[授权说明](./LICENSING.md)。

问题与建议请通过 [GitHub Issues](https://github.com/ChenyCHENYU/MachReport/issues) 提交。
