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
pnpm run version              # 合并 changeset 并同步 README 版本，检查后提交推送
pnpm release                  # 已提交版本的发版：clean gate → install → verify → E2E → publish
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
2. 用户授权发布后执行 `pnpm run version`，核对版本与 CHANGELOG；锁文件需要更新时正常安装后再验证 frozen install
3. 完整校验并提交推送源码和版本；执行 `pnpm release`，保持工作区干净，标签必须指向实际发布提交
4. 推送发布标签，验证 `npm dist-tag ls @agile-team/mach-report` 及实际 tarball（CDN 传播可能稍有延迟）
5. npm 认证优先使用本机配置；临时凭据配置仅存系统临时目录、权限 600，完成或失败后立即删除。token 绝不写入仓库、命令历史或日志；轮换走 npmjs.com
6. 发布物通过 `publishConfig.registry` 固定官方 `https://registry.npmjs.org`；安装镜像可以由开发环境选择，发布不得跟随本机镜像源。临时环境配置同时处理 npm 大小写环境变量，避免子进程覆盖目标。

## 已知未了项

- 设计器（拖拽画布）与管理控制台 UI 为独立立项的多轮工程
- npm token 轮换为人工事项（会话中出现过的凭证视为已泄露处理）
