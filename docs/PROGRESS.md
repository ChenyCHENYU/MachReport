# MachReport 迭代进度日志

> 通宵自主执行模式 · 每个闭环 = 实现 → 测试 → 验证 → 检查点提交
> 验证命令：`pnpm typecheck && pnpm lint && pnpm test && pnpm exec playwright test`

## 最终交付状态（2026-09-17 03:05 · 值守至 06:00）

- **28 个检查点提交 · 6 个包 · 131 单测 + 4 真浏览器 E2E 全绿**
- typecheck（tsc + vue-tsc SFC）/ lint 0 错误
- core / sql-engine / vue / federation（remoteEntry 产物）/ manager / pdf
- jh4j 兼容三件套：gridPlan 适配器 + 模板导入转换器 + expose 契约对齐
- **PDF 前端直出已落地**（pdf-lib + fontkit 中文子集嵌入，E2E 真实下载断言）
- **AST 级 SQL 校验已落地**（node-sql-parser MySQL 方言，方言失败自动降级词法）

| 检查点时间线 | commit | 内容 | 验证 |
|---|---|---|---|
| 1 | 00:46 | e5061d6 | 脚手架 + core v0.1（schema/units/textwrap/paginate/DOM 渲染器） | 28 tests |
| 2 | 01:30 | a4cb69b | sql-engine v0.1（三语法编译 + 表达式求值 + 单 SELECT 校验） | 49 tests |
| 3 | 01:37 | fe39161 | vue v0.1 契约组件 + jh4j/local 双适配器 | 59 tests |
| 4 | 01:45 | 9bebaba | example 构建（gzip 34KB）、typecheck 收敛 | build ✓ |
| 5 | 01:52 | 7ddd415 | core v0.2 视口虚拟化 + 性能预算门 | 70 tests |
| 6 | 02:10 | — | designer chunk 逆向（模板 JSON + 锁 API） | docs |
| 7 | 02:20 | — | RenderPlan 校验器（JSON path 行级定位） | 81 tests |
| 8 | 02:30 | — | eslint 质量门（flat config，0 errors） | lint ✓ |
| 9 | 02:45 | — | federation 入口包（expose 契约对齐） | 85 tests |
| 10 | 03:00 | — | jh4j 模板导入转换器（逆向 schema 驱动） | 90 tests |
| 11 | 03:15 | — | Playwright 真浏览器 E2E ×3 | e2e ✓ |
| 12 | 03:35 | — | 边界补强（嵌套 if/转义/200 条件/万行冒烟） | 106 tests |
| 13 | 03:50 | — | federation 可部署构建（remoteEntry + 产物守卫） | 109 tests |
| 14 | 04:10 | — | 字体模型校准（Chromium 实测数据驱动） | 109 tests |
| 15 | 04:20 | — | vue-tsc SFC 类型检查（抓出 1 个真 bug）+ 打印分页保护 | 全绿 |
| 16 | 04:55 | — | manager 包：管理端 API 客户端（模板/数据集/参数/导入导出/模板锁 holdLock） | 116 tests |
| 17 | 02:55* | — | template builder DSL（类型化链式建模板） | 121 tests |
| 18 | 03:10* | — | PDF 前端直出包（fontkit 中文子集）+ E2E 下载断言 | 125 tests |
| 19 | 03:00* | — | AST 级 SQL 校验（node-sql-parser + 词法双保险） | 131 tests |

（* 为机器本地时间 HH:mm；同一夜内机器时间与日志序号不完全单调，以 git 顺序为准）

最终：**131 单测 + 4 E2E 全绿 · typecheck(含 SFC)/lint 0 错误 · 28 个检查点提交**

## 实测性能（happy-dom 环境，真浏览器更快）

| 指标 | 数值 |
|---|---|
| 分页 5,000 行（139 页） | **56ms** |
| DOM 渲染 | 28ms/页（全量渲染非热路径，虚拟化后仅渲染窗口内 2-3 页） |
| 视口窗口计算 1000 页 × 100 次 | **1.65ms** |
| example 整包（含 Vue 运行时） | gzip 34KB |

## 已完成能力清单

### core (@mach-report/core)
- [x] RenderPlan schema（对齐 jh4j gridPlan 逆向结构）
- [x] mm↔px↔pt 单位系统 + 纸张尺寸表
- [x] 近似文本测量（CJK/拉丁宽度模型）与折行
- [x] 模板→RenderPlan 分页引擎：跨页/表头重复/行高自适应/列宽缩放/万行稳定
- [x] DOM 渲染器：文本/富文本/预折行/图片类/形状/真实 table 网格
- [x] **视口页级虚拟化**（computePageWindow + 组件接入）
- [x] **性能预算测试**（CI 回归门）
- [x] **RenderPlan 校验器**：error/warning 分级、JSON path 行级定位、坏数据防御
- [x] **jh4j 模板导入转换器**：逆向 schema（GlobalConfig/PageNode/ElementNode）→ ReportTemplate，未知降级+告警不抛错

### sql-engine (@mach-report/sql-engine)
- [x] `#{}`/`${}`/`{if(cond,a,b)}` 全语法（手册三范式 + 嵌套 if 回退再编译）
- [x] 表达式求值器：isEmpty/==/!=/+、双引号字符串、`\{` 转义、括号嵌套
- [x] 单 SELECT 结构校验：注释剥离/多语句/DML/DDL/SELECT INTO 拒绝
- [x] 缺参容错（NULL 绑定+告警）；200 动态条件稳定性

### vue (@mach-report/vue)
- [x] ReportPreview 契约组件：props/emits/expose 与 jh4j 1:1
- [x] 换单据先清空再渲染（根治闪旧内容）；错误态+重试
- [x] jh4j gridPlan 适配器（request 注入）+ 本地适配器（core 直出）
- [x] 工具栏：翻页/适宽/100%/150%/导出/打印/PDF 窗口；打印 iframe+@page
- [x] 渲染前 schema 校验（行级错误直达 UI）

### federation (@mach-report/federation)
- [x] reportPreview/reportHtmlPreview/filePreview 三入口，expose 名对齐
- [x] fetcher 通过 InjectionKey provide/inject 注入（宿主掌控数据面）

### 工程
- [x] pnpm monorepo / TS strict / vitest(106) / Playwright E2E(3) / eslint(0 err)
- [x] 性能预算门 + 逆向文档 + 进度日志

## 夜间未完成 → 后续队列

- [ ] **PDF 前端直出**（pdf-lib + 中文字体子集嵌入；打印 iframe 方案已可用）
- [ ] **designer/manager 包**（画布设计器 MVP：网格布局/文本/列表/条码；管理端列表/发布/导入导出）
- [ ] canvas 渲染后端（当前 DOM 后端 + 虚拟化已达标，canvas 为进阶）
- [ ] jh4j 模板导入覆盖表格 Cells 完整结构（当前已支持文本/表格/线条/形状，富文本降级为纯文本）
- [ ] shadow DOM 样式隔离（宿主集成时验证必要性）
- [ ] 字体测量升级：浏览器 canvas measureText 校准近似模型
- [ ] CI（GitHub Actions：typecheck+lint+test+e2e）

## 关键决策记录

1. **不兼容 jh4j 私有模板格式**（PascalCase 历史结构），自研干净 ReportTemplate + 单向导入器——逆向证实完整兼容成本高且无必要
2. **校验器 error/warning 分级**：未知 kind 是 warning（jh4j 有扩展组件，不能阻断渲染），结构损坏才是 error
3. **性能预算用"率"不用绝对值**（happy-dom 有噪声；28ms/页门防数量级回归）
4. **多列表顺序流分页**（L2 接 L1 末页）——v0.2 语义，独立分页流进 roadmap
5. **嵌套 {if} 用未引用分支回退机制**（jh4j 公式语言无引号转义，嵌套引用无法表达；回退再编译天然支持任意深度）
