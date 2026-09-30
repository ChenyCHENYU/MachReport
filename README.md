# MachReport

**面向 B 端打印报表的高性能 TypeScript 报表引擎** —— 对标并兼容 jh4j-cloud-report（打印报表平台），目标是契约级 drop-in 替换、渲染性能显著超越、工程健壮性全面升级。

> Mach 家族命名对齐：MachTable（数据表格）→ **MachReport**（打印报表）。

## 当前状态（2026-09-30 v0.5 · 单包零依赖已发 npm）

> 发布形态对齐 mach-table 家族：**安装 = 恰好 2 个包**（vue 适配包 + 引擎单包，引擎零运行时依赖——pdf-lib/node-sql-parser 打进 `./pdf` `./sql` 子路径产物，不装不进依赖图）。

| 能力 | 状态 |
|---|---|
| 引擎单包（分页/虚拟化/校验/DOM+Canvas 双后端/builder DSL/共享几何与样式解析/TextMeasurer 注入/PDF 直出/动态 SQL/管理端 API） | ✅ 可用（5k 行分页 ~57ms，热路径零逐行分配） |
| **Canvas 窗口化分页器**（画布池 + 分帧，内存 O(窗口) 而非 O(总页数)） | ✅ 可用（E2E 实证：滚动复用不增长） |
| Vue 适配单包（契约组件 + **零配置插件** + **配置中心（presets/文案/主题）** + `./async` 异步入口 + transform 缩放） | ✅ 可用 |
| federation 入口（expose 对齐 + remoteEntry 产物 + **宿主 harness 实证**） | ✅ 可用 |
| jh4j 模板导入转换器 / 打印管线（流式分块 + named pages 混合纸张） | ✅ 可用 |
| E2E（真 Chromium：渲染/翻页/缩放矩阵/PDF 下载/联邦宿主/Canvas 结构化像素/窗口化分页器） | ✅ 9 specs（0 重试稳定） |
| 真实 gridPlan 契约联调 | 🟡 工具链就绪（`pnpm capture:gridplan` 登录一次即激活守卫） |
| 设计器画布 UI | 🚧 后续里程碑 |

```bash
pnpm install && pnpm test          # 201 单测全绿
pnpm --filter @agile-team/example-minimal dev   # 演示：localhost:8610
```

详见：[docs/PROGRESS.md](docs/PROGRESS.md)（迭代日志/决策记录）· [docs/API.md](docs/API.md)（接入速查）· [docs/reverse-findings.md](docs/reverse-findings.md)（jh4j 逆向）。

---

## 快速上手

### 安装（Vue 业务项目：恰好 2 个包）

```bash
pnpm add @agile-team/mach-report-vue   # 自动携带 @agile-team/mach-report（引擎零依赖）
```

**零配置（同源 jh4j 部署——无 axios、无胶水代码）：**

```ts
import { createApp } from "vue";
import { ReportPreview, machReportPlugin } from "@agile-team/mach-report-vue";
import "@agile-team/mach-report-vue/style.css";

createApp(App).use(machReportPlugin).mount("#app");

// 任意业务页面：一行使用
<ReportPreview temp-id="CK_TEMPLATE_001" :params="{ id: '9' }" />
```

**带网关/axios/配置中心（推荐收敛到独立配置文件）：**

```ts
// src/config/mach-report.config.ts
import { defineMachReportConfig, defineMachReportPreset } from "@agile-team/mach-report-vue";

export default defineMachReportConfig({
  defaults: {
    gapPx: 18,
    pdfFontUrl: "/simhei.ttf",
    messages: { title: "Report Preview" },   // 工具栏/状态文案（i18n）
    theme: { shellBg: "#2b2b2b", btnActiveBg: "#1677ff" } // --mrp-* 主题变量
  },
  presets: {
    lean: defineMachReportPreset({ showExport: false, showPrint: false }), // 纯预览
    print: defineMachReportPreset({ showPdfWindow: false })
  },
  defaultPreset: "lean"
});

// main.ts
import axios from "axios";
app.use(machReportPlugin, { request: axios, baseUrl: "/sub/mach-report", config: machReportConfig });
// 或零依赖 fetch 适配：app.use(machReportPlugin, { baseUrl: "/sub/mach-report" })
```

优先级：**组件 props > 路由级 `provideMachReportConfig(overlay)` > preset > defaults > 内置缺省**（对齐 mach-table 配置中心约定）。

**首屏敏感页面（异步入口）：**

```ts
import AsyncMachReportPlugin, { preloadMachReport } from "@agile-team/mach-report-vue/async";
app.use(AsyncMachReportPlugin, { baseUrl: "/sub/mach-report" });
void preloadMachReport(); // 可选：路由 hover 时预取组件分片
// 模板：<MachReportPreview temp-id="X" />
```

### 框架无关 / Node 侧（引擎单包，子路径按需）

```bash
pnpm add @agile-team/mach-report    # 零运行时依赖；ESM + CJS 双格式
```

```ts
import { createTemplate, paginateTemplate } from "@agile-team/mach-report";
import { renderPlanToPdf } from "@agile-team/mach-report/pdf";              // PDF 直出（pdf-lib 已内联）
import { renderDynamicSql } from "@agile-team/mach-report/sql";             // 动态 SQL（解析器已内联）
import { createReportAdminClient } from "@agile-team/mach-report/manager";  // 管理端 API
```

### 本地模板（离线/单测）

```ts
import { createTemplate } from "@agile-team/mach-report";
import { createLocalFetcher } from "@agile-team/mach-report-vue";

const template = createTemplate()
  .page("a4", { landscape: true, margins: { marginTopMm: 12 } })   // 纸张预设 + 横向
  .text("出库单", { leftMm: 70, topMm: 4, widthMm: 70 }, { fontSize: 16, bold: true })
  .list("detail", { leftMm: 12, topMm: 20, widthMm: 186 }, [
    { header: "序号", field: "no", widthMm: 20 },
    { header: "物料", field: "name", widthMm: 100 }
  ])
  .build();

const fetcher = createLocalFetcher({
  T1: { tempId: "T1", template, datasets: { detail: rows } }
});
```

### 大报表 Canvas 渲染（窗口化）

```ts
import { createCanvasPager } from "@agile-team/mach-report";
const pager = createCanvasPager(plan, { dpr: window.devicePixelRatio, overscan: 1 });
pager.attach(scrollContainer);   // 视口窗口 + 画布池复用 + 每帧限量绘制
pager.destroy();                 // 卸载释放
```

---

## 一、背景与问题

现网 jh4j-cloud-report（依据《打印报表平台_运维操作手册》+ SIT 产物逆向分析）存在以下可改进点：

| 现状 | 问题 |
|---|---|
| 预览全量 DOM 渲染（ReportGridRenderer + shadow DOM） | 大报表（多页/千行明细）首屏慢、缩放重排开销大 |
| PDF 依赖后端渲染管线（`/report/codePrintReport/preview`） | 每次打印一次后端往返；后端字体/分页与前端 HTML 存在两套实现，手册自己承认"HTML 为提速做了近似换算，以 PDF 为准"——双真相源 |
| 动态 SQL 靠运行时字符串规则（"仅允许单条 SELECT"） | 校验强度有限，注入面靠约定 |
| 设计器与列表双标签页、保存后需手动刷新 | 状态同步靠人肉 |
| 闭源产物（本地无源码） | 无法二开、无法修 bug、无法自部署 |

## 二、目标

1. **契约兼容（P0）**：组件名/暴露路径/props/事件/ref 方法/接口形状与 jh4j 一致，业务前端（含我们已接入的 `wl-ui-produce` `C_ReportPreview`）**零改动切换**
2. **性能更好（P0）**：见"性能目标"
3. **更健壮（P1）**：单真相源渲染（一份渲染描述 → 屏幕/PDF/打印三出口）、AST 级 SQL 校验、模板 schema 校验、全链路错误边界
4. **开源可控（P1）**：源码自有，可嵌入现有微服务体系

## 三、总体架构

```
MachReport (pnpm monorepo, TS-first, core 零运行时依赖)
├── packages/
│   ├── core/            # 渲染引擎（框架无关）：模板 schema + 分页计算 + 双后端(DOM/Canvas)渲染器
│   ├── sql-engine/      # 动态 SQL：#{}/$()/{}/{if} 兼容语法 + AST 校验 + 参数化编译
│   ├── designer/        # 设计器（Vue 3）：画布/属性面板/组件库/Word/Excel 导入
│   ├── manager/         # 管理端（Vue 3）：目录树/模板列表/数据源/数据集/参数/发布/导入导出
│   ├── vue/             # Vue 3 适配层：ReportPreview/ReportHtmlPreview/FilePreview 组件（契约兼容层）
│   ├── federation/      # 模块联邦远程入口：expose 名与 jh4j 完全一致（./{module}/reportPreview ...）
│   └── server/          # (后期) 自研后端：模板存储/gridPlan/数据源代理/PDF——先做适配器消费 jh4j 后端
├── examples/            # 演示工程（对接 SIT 数据）
├── tests/               # Vitest 单测 + Playwright E2E（对齐 MachTable 工程标准）
└── docs/
```

### 核心设计决策

**1. 单真相源渲染（对比 jh4j 的最大差异化）**

jh4j：HTML 预览（前端近似）与 PDF（后端管线）两套渲染，存在细微不一致。
MachReport：`模板 JSON + 数据 → 渲染计划(RenderPlan)` 一份中间表示，三出口：

```
RenderPlan ──> DOM/Canvas 渲染器（屏幕预览，虚拟化）
           ──> pdf-lib 矢量输出（前端直出 PDF，省一次后端往返）
           ──> print 管线（@media print CSS + iframe，兼容现有打印习惯）
```

RenderPlan 与 jh4j `gridPlan` 接口返回结构保持兼容（pages[]、pageWidthMm、mm 坐标系、MM_TO_PX=96/25.4 换算——已在 SIT 产物中确认），保证切换期可混用。

**2. 渲染引擎**

- 坐标系：mm 为源单位（与 jh4j 一致），渲染时换算 px
- 双后端：DOM 后端（调试友好/文本可选中）+ Canvas 后端（性能：整页位图化，缩放=矩阵变换零重排）
- 虚拟化：只渲染视口 ±1 页，页内明细行按需绘制（对标 MachTable 行虚拟化经验）
- 样式隔离：shadow DOM（沿用 jh4j 已验证的方案，避免宿主样式污染）
- 增量更新：params 变更只重算受影响数据集 → 局部重绘，不整页重建

**3. 动态 SQL 引擎（sql-engine）**

- 兼容三语法：`#{p}`（绑定变量）/ `${p}`（文本替换，标注注入风险）/ `{if(cond, a, b)}`（动态拼接），公式内双引号规则与 jh4j 一致，存量 SQL 零改写
- 编译期用 SQL parser（node-sql-parser）做 AST 校验：**只允许单条 SELECT**（结构性保证，而非字符串启发式）、禁止 DML/DDL/多语句
- 产出：`{ sql, binds }` 供后端参数化执行；自带 explain/预览模式

**4. 契约兼容层（vue + federation 包）**

| 契约项 | 对齐方式 |
|---|---|
| expose 路径 | `./mach-report/reportPreview` 等（模块名可配置；切流时网关配 /sub/mach-report/ 即可） |
| props | temp-id / furniture-temp-id / params / height / auto-load / show-export / show-print / show-pdf-window，默认值一致 |
| 事件/ref | loaded(pageCount) / error(message)；reload / print / exportAs / openPdfWindow / gotoPage |
| 接口 | /report/codePrintReport/gridPlan | export | preview 路径与出入参兼容（适配器模式，后期指向自研后端） |
| 打印 | iframe + blob 方案保留，新增 print 样式管线 |

**5. 后端策略（分期）**

- **M1-M2**：不自研后端。渲染数据继续走 jh4j 的 gridPlan（SIT 已部署、接口已逆向），MachReport 只替换前端渲染与管理端皮肤 → 风险最低的切流路径
- **M3+**：自研 server 包（Java/Spring 融入 jh4j 微服务体系，或 Node BFF），模板存储兼容 jh4j 导出 ZIP 格式，实现存量模板迁移

## 四、性能目标（验收口径）

| 指标 | jh4j 现状（实测感知） | MachReport 实测/目标 |
|---|---|---|
| 分页 5,000 行（139 页） | 秒级（全量 DOM） | **~57ms**（热路径样式驻留 + 字宽查表，单测预算门锁定） |
| 100 页含千行明细首屏 | 秒级 | < 300ms（虚拟化 + canvas 窗口化分页器） |
| 缩放/翻页 | 触发重排 | < 16ms（transform 矩阵变换，无重排） |
| Canvas 大报表内存 | — | **O(窗口)**：画布池复用 + 分帧（A4@dpr2 ≈14MB/页，全量渲染不可行） |
| 打印/PDF 导出 | 后端往返 1-3s | < 500ms（前端矢量直出，字体子集化 + IndexedDB 缓存）；打印流式分块无长任务 |
| 引擎包体积 | 随 jh4j 整包 | core < 60KB gzip（零依赖 + sideEffects:false 可摇树），设计器按需异步 |

## 五、健壮性设计

- 模板 JSON 带 schemaVersion + JSON Schema 校验，坏模板给出行级错误定位（jh4j 导入失败"带原因不自动关闭"的体验保留并加强）
- 数据集字段快照 diff（解决 jh4j"改列后必须手点同步"的设计缺陷：自动检测漂移并提示）
- 渲染超时/失败错误边界组件 + 重试；数据集级失败不拖垮整张报表
- E2E：对齐 MachTable 标准（Playwright），核心链路（建模板→设计→预览→打印）自动化回归
- 换单据闪旧内容问题在组件层根治（内部 watch tempId 清空，不依赖业务方记得 :key）

## 六、里程碑

| 阶段 | 内容 | 产出 | 预估 |
|---|---|---|---|
| M0 | 逆向补全：拉取 SIT 全部 chunk 分析模板 JSON 结构、gridPlan 完整 schema、导出 ZIP 格式 | 逆向文档 + 类型定义 | 3-5 天 |
| M1 | core 渲染引擎 + vue 契约层，消费 jh4j gridPlan | 可嵌入 wl-ui-produce 的预览组件（切流第一刀） | 2-3 周 |
| M2 | sql-engine + manager 管理端（目录/模板/数据源/数据集/参数/发布） | 管理端可替换 | 3-4 周 |
| M3 | designer 设计器 MVP（网格布局/文本/列表/图片/条码/二维码/页眉页脚） | 新模板可全流程制作 | 4-6 周 |
| M4 | PDF 前端直出、Word/Excel 导入、富文本/图表/子报表、自研后端评估 | 全功能对齐 | 持续 |

## 七、风险与待决问题（需要拍板）

1. **模板 JSON 格式**：jh4j 无源码，模板结构靠 M0 逆向。若格式含后端私有序列化，兼容成本上升 → M0 先验证
2. **后端语言**：自研后端选 Java（融入 jh4j 微服务）还是 Node BFF？影响 M4
3. **设计器复杂度**：富文本（其 richtextDesigner 独立 expose）与 Word 导入是工作量黑洞，MVP 是否先砍
4. **条码/二维码扫码兼容**：前端生成（jsbarcode/qrcode）与后端生成的可识别度差异，需扫码枪实测
5. **切流策略**：与 jh4j 并行期多久、federation 模块名是共存（mach-report）还是顶替（同 jh4j-cloud-report 名）——建议共存灰度

## 八、工程标准（对齐 MachTable）

pnpm monorepo / TypeScript strict / core 零运行时依赖 / changesets 版本管理 / ESLint+Prettier+commitlint / Vitest + Playwright / CI（GitHub Actions）
