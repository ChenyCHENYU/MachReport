# AGENTS.md — MachReport 仓库协作指南

供后续接手的 agent 与工程师使用：命令、架构地图、发布流程、红线。

## 常用命令

```bash
pnpm install --frozen-lockfile # 安装（pnpm 11.8.0，开发 Node ≥ 22.13）
pnpm typecheck                # tsc 项目图 + vue-tsc（mach-report/federation）
pnpm lint / lint:fix          # ESLint（0 错 0 警是门禁）
pnpm test                     # Vitest 单测（全绿门禁；纯逻辑文件用 // @vitest-environment node 头分流）
pnpm test:coverage            # 覆盖率（关注 layout/ render/ format.ts）
pnpm build                    # 全工作区构建（mach-report 六入口 ESM+CJS + federation + examples）
pnpm check:docs               # 文档相对链接、README 发布同步与 SVG 资源检查
pnpm check:consumer           # 实际 npm 包隔离消费，ESM/CJS 运行与严格类型检查
pnpm verify                   # 类型 → lint → build → 覆盖率/产物守卫 → 文档 → 消费端
pnpm test:e2e                 # E2E（真 Chromium；配置自动启动 examples dev server）
pnpm release                  # 一键发版：changeset version → install → verify → E2E → publish
```

## 架构地图

- 单 npm 包 `packages/mach-report`（唯一发布物；workspace 另有 federation 部署件与 examples）
- `src/`：`layout/`（分页+折行）`render/`（DOM/Canvas/几何/样式/虚拟化）`schema/` `builder/` `format.ts`（值格式化/条件规则）
- 子路径域：`src/pdf` `src/sql` `src/xlsx` `src/vue`——重依赖（pdf-lib/node-sql-parser/exceljs）与框架代码只存在于子路径产物；ExcelJS 声明内联，唯一依赖 `@types/node` 用于公开 Workbook 的 Node 类型签名
- 数据来源通过 `PlanFetcher({ reportIds, params })` 注入；不得在插件中内置某个项目的接口路径、鉴权或响应格式
- 常规接入使用插件 `reports` 或核心 `createReportSource`：宿主只定义模板、取数和字段映射，包内统一分页、参数元数据、校验与页合并。Vue 入口重导出核心 API；保留旧 fetcher 逃生口，signal / onWarning 为可选增强。
- 父页面控制用 `useMachReport` 的稳定 ref / ready / 方法；重载与卸载必须取消旧取数，导出必须去重并隔离过期结果。同步打开 PDF 窗口，避免丢失浏览器用户手势。
- **ESLint 边界规则**：引擎核心不得 import 任何子路径域（主入口零重依赖零框架，有产物守卫测试双保险）
- 自引用（self-reference）：vue 子路径静态依赖引擎、PDF 懒加载走 `./pdf`，构建时外部化

## 约定

- 版本：changesets（`.changeset/*.md` → `pnpm run version`，同步 README 源码版本）
- 测试先行：新能力必须带单测；数据源测试使用真实分页，Vue 测试真实挂载并清理。渲染几何/坐标回归走 E2E 结构化断言（见 `e2e/canvas.spec.ts`）
- 性能预算：`perf-budget.test.ts` 的阈值改动需在 PR 说明理由
- 文案/主题：走 `config.ts` 的 messages/theme（不要硬编码）
- 主分支 main；使用 `git remote -v` 确认已配置远端，仅在用户授权后推送或发布。GitHub clone 默认只有 origin，不假设存在 gitee。

## 发布流程（pnpm release 的展开）

1. 写 `.changeset/xxx.md`（bump 类型 + 变更说明）
2. 用户授权发布后执行 `pnpm release`（版本合并 → 锁文件安装 → 完整校验 → E2E → npm publish）
3. 验证：`npm dist-tag ls @agile-team/mach-report`（新版本 CDN 传播可能延迟几分钟，tarball 端点先行可用）
4. npm token 只放 `~/.npmrc`，绝不入仓库；轮换走 npmjs.com

## 已知未了项

- 设计器（拖拽画布）与管理控制台 UI 为独立立项的多轮工程
- npm token 轮换为人工事项（会话中出现过的凭证视为已泄露处理）
