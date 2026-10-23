# AGENTS.md — MachReport 仓库协作指南

供后续接手的 agent 与工程师使用：命令、架构地图、发布流程、红线。

## 常用命令

```bash
pnpm install --frozen-lockfile # 安装（pnpm 11.8.0，开发 Node ≥ 22.13）
pnpm typecheck                # tsc 项目图 + vue-tsc（mach-report/federation）
pnpm lint / lint:fix          # ESLint（0 错 0 警是门禁）
pnpm test                     # Vitest 单测（全绿门禁；纯逻辑文件用 // @vitest-environment node 头分流）
pnpm test:coverage            # 全生产代码覆盖率；语句85/分支80/函数85/行90为下限
pnpm build                    # 全工作区构建（mach-report 十三代码入口 ESM+CJS + federation + examples）
pnpm check:docs               # 文档相对链接、README 发布同步与 SVG 资源检查
pnpm check:consumer           # 实际 npm 包隔离消费，ESM/CJS 运行与严格类型检查
pnpm check:compat             # 实际包的 Node/Vue 严格类型与运行消费（支持 --archive/--node/--vue）
pnpm check:server-example     # Java17目标客户端→Node真实HTTP、精度、错误、取消、下载与混合并发
pnpm check:quality            # 生产代码圈复杂度 ≤20，统计全部 TS / Vue 函数
pnpm check:api                # 十三入口公开声明签名；调整API后审查差异再用 --update
pnpm check:sbom               # 依赖版本/许可证证据、锁文件和构建产物摘要
pnpm verify                   # 类型 → lint/复杂度 → build → API/SBOM → 覆盖率 → 文档 → 消费端
pnpm test:e2e                 # E2E（真 Chromium；配置自动启动 examples dev server）
pnpm run version              # 合并 changeset 并同步 README 版本，检查后提交推送
pnpm release                  # 已提交版本的发版：clean gate → install → verify → Java/Node参考 → 当前环境兼容消费 → E2E → publish
```

## 架构地图

- 单 npm 包 `packages/mach-report`（唯一发布物；workspace 另有 federation 部署件与 examples）
- `src/`：`layout/`（分页+折行）`render/`（DOM/Canvas/几何/样式/虚拟化）`schema/` `builder/` `format.ts`（值格式化/条件规则）
- 子路径域：`src/pdf` `src/sql` `src/xlsx` `src/vue` `src/codes`——重依赖（pdf-lib/node-sql-parser/exceljs/BWIPP/PNG）与框架代码只存在于子路径产物；ExcelJS 声明内联，唯一依赖 `@types/node` 用于公开 Workbook 的 Node 类型签名
- `source/` 管数据来源、参数与模板版本；`editing/` 是纯事务逻辑；`vue/composables/` 管选区、历史、冻结、搜索和生命周期，不把业务身份绑定到DOM行号。
- `server/` 是共用Runtime/预算/队列，`worker/` 是可序列化RPC桥；Node线程与流式Excel分别在 `/server/node`、`/xlsx/node`，使用独立Node构建。节点声明在临时子目录聚合后移入dist，避免覆盖浏览器声明。
- `processing/` 是纯计算/聚合/矩阵公共层，`analytics/` 保留按需公共外观与基础图元；`output/` 管能力诊断与资源；`designer/` 为独立可选Vue画布/向导/规则/验收组件，复用预览与模板管理，不进入核心入口。
- `layout/record-pages` 为固定标签逐记录/份数/版面惰性展开，`record-bindings`只读自有标量字段；`/codes`用成熟BWIPP编码为跨平台PNG，静区/模块/载荷/缓存有界，禁止假码。Runtime的本地`assets`在执行器内部配置，不序列化函数。
- `source/template-review` 做显式样例预检；`server/publication` 做真实文件编码验收。持久任务使用 `server/job-service` 的租约/attempt围栏，文件适配器仅单进程；多实例原子CAS由宿主实现。
- 数据来源通过 `PlanFetcher({ reportIds, params })` 注入；不得在插件中内置某个项目的接口路径、鉴权或响应格式
- 常规接入使用插件 `reports` 或核心 `createReportSource`：宿主只定义模板、取数和字段映射，包内统一分页、参数元数据、校验与页合并。Vue 入口重导出核心 API；保留旧 fetcher 逃生口，signal / onWarning 为可选增强。
- 父页面控制用 `useMachReport` 的稳定 ref / ready / 方法；重载与卸载必须取消旧取数，导出必须去重并隔离过期结果。同步打开 PDF 窗口，避免丢失浏览器用户手势。
- **ESLint 边界规则**：引擎核心不得 import 任何子路径域（主入口零重依赖零框架，有产物守卫测试双保险）
- **复杂度门禁**：所有生产 TS / Vue 函数 complexity ≤20，无文件豁免；按校验、测量、几何、输出职责拆分，禁止为数字删分支或转移到使用侧。
- 自引用（self-reference）：vue 子路径静态依赖引擎、PDF 懒加载走 `./pdf`，构建时外部化

## 约定

- 版本：changesets（`.changeset/*.md` → `pnpm run version`，同步 README 源码版本）
- 测试先行：新能力必须带单测；数据源测试使用真实分页，Vue 测试真实挂载并清理。渲染几何/坐标回归走 E2E 结构化断言（见 `e2e/canvas.spec.ts`）
- 单测与浏览器测试均零重试；实际失败先定位，不降低既有性能预算来通过门禁。
- 性能预算：`perf-budget.test.ts` 的阈值改动需在 PR 说明理由
- 文案/主题：走 `config.ts` 的 messages/theme（不要硬编码）
- 主分支 main；使用 `git remote -v` 确认已配置远端，仅在用户授权后推送或发布。GitHub clone 默认只有 origin，不假设存在 gitee。

## 发布流程（pnpm release 的展开）

1. 写 `.changeset/xxx.md`（bump 类型 + 变更说明）
2. 用户授权发布后执行 `pnpm run version`，核对版本与 CHANGELOG；锁文件需要更新时正常安装后再验证 frozen install
3. 完整校验并提交推送源码和版本；执行 `pnpm release`，保持工作区干净，标签必须指向实际发布提交
4. 推送发布标签，验证 `npm dist-tag ls @agile-team/mach-report` 及实际 tarball（CDN 传播可能稍有延迟）；下载后用 `node scripts/check-consumer.mjs /path/package.tgz`复用隔离消费门禁
5. npm 认证优先使用本机配置；临时凭据配置仅存系统临时目录、权限 600，完成或失败后立即删除。token 绝不写入仓库、命令历史或日志；轮换走 npmjs.com
6. 发布物通过 `publishConfig.registry` 固定官方 `https://registry.npmjs.org`；安装镜像可以由开发环境选择，发布不得跟随本机镜像源。临时环境配置同时处理 npm 大小写环境变量，避免子进程覆盖目标。

## 已知未了项

- 已提供毫米画布、Excel绑定向导和声明式规则；完整Excel公式引擎、宏、审批控制台仍不在通用内核内
- npm token 轮换为人工事项（会话中出现过的凭证视为已泄露处理）
