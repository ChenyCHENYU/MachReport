# AGENTS.md — MachReport 仓库协作指南

供后续接手的 agent 与工程师使用：命令、架构地图、发布流程、红线。

## 常用命令

```bash
pnpm install                  # 安装（pnpm ≥ 11，Node ≥ 18）
pnpm typecheck                # tsc 项目图 + vue-tsc（mach-report/federation）
pnpm lint / lint:fix          # ESLint（0 错 0 警是门禁）
pnpm test                     # Vitest 单测（全绿门禁；纯逻辑文件用 // @vitest-environment node 头分流）
pnpm test:coverage            # 覆盖率（关注 layout/ render/ format.ts）
pnpm build                    # 全工作区构建（mach-report 六入口 ESM+CJS + federation + examples）
pnpm exec playwright test     # E2E（真 Chromium，先起 examples dev server；0 重试应稳定）
pnpm release                  # 一键发版：changeset version → install → build → test → publish
```

## 架构地图

- 单 npm 包 `packages/mach-report`（唯一发布物；workspace 另有 federation 部署件与 examples）
- `src/`：`layout/`（分页+折行）`render/`（DOM/Canvas/几何/样式/虚拟化）`schema/` `builder/` `format.ts`（值格式化/条件规则）
- 子路径域：`src/pdf` `src/sql` `src/xlsx` `src/vue`——重依赖（pdf-lib/node-sql-parser/exceljs）与框架代码只存在于子路径产物
- 数据来源通过 `PlanFetcher({ reportIds, params })` 注入；不得在插件中内置某个项目的接口路径、鉴权或响应格式
- **ESLint 边界规则**：引擎核心不得 import 任何子路径域（主入口零重依赖零框架，有产物守卫测试双保险）
- 自引用（self-reference）：vue 子路径静态依赖引擎、PDF 懒加载走 `./pdf`，构建时外部化

## 约定

- 版本：changesets（`.changeset/*.md` → `pnpm changeset version`）
- 测试先行：新能力必须带单测；渲染几何/坐标回归走 E2E 结构化断言（见 `e2e/canvas.spec.ts`）
- 性能预算：`perf-budget.test.ts` 的阈值改动需在 PR 说明理由
- 文案/主题：走 `config.ts` 的 messages/theme（不要硬编码）
- 双远端：origin（GitHub SSH）+ gitee（HTTPS）；主分支 main（推送两边：`git push origin main --tags && git push gitee main --tags`）

## 发布流程（pnpm release 的展开）

1. 写 `.changeset/xxx.md`（bump 类型 + 变更说明）
2. `pnpm release`（版本合并 → 构建 → 全测 → npm publish）
3. 验证：`npm dist-tag ls @agile-team/mach-report`（新版本 CDN 传播可能延迟几分钟，tarball 端点先行可用）
4. npm token 只放 `~/.npmrc`，绝不入仓库；轮换走 npmjs.com

## 已知未了项

- 设计器（拖拽画布）与管理控制台 UI 为独立立项的多轮工程
- npm token 轮换为人工事项（会话中出现过的凭证视为已泄露处理）
