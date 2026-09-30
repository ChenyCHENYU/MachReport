---
"@agile-team/mach-report": minor
---

终态单包：一个包覆盖全部能力（目录架构 + 子路径导出替代分包）：

- vue 适配层并入 `./vue` `./vue/async` `./vue/style.css` 子路径；vue 为 optional peer（非 Vue 宿主不安装框架）
- 引擎主入口保持零框架耦合与零运行时依赖；自引用（self-reference）让 vue 子路径复用引擎产物、PDF 懒加载走 ./pdf
- 统一 vite 六入口 × ESM/CJS 构建（含 .vue 类型声明与 .d.cts）
- 旧的 @agile-team/mach-report-vue 已废弃：改为 `import { ReportPreview, machReportPlugin } from "@agile-team/mach-report/vue"`
