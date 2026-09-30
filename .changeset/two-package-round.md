---
"@agile-team/mach-report": minor
"@agile-team/mach-report-vue": minor
---

安装收敛到恰好 2 个包 + 配置化对齐 mach-table 体验：

- 引擎零运行时依赖：tsup 四入口独立打包，pdf-lib/fontkit 内联 ./pdf 产物、node-sql-parser 内联 ./sql 产物；ESM+CJS 双格式 + .d.ts/.d.cts + engines node>=18（安装从 5 包降为 2 包）
- PdfDocumentHandle：PDF 结果句柄不透明化，公共类型不再泄漏 pdf-lib
- 零配置插件：内置 createFetchRequest（全局 fetch 适配），app.use(machReportPlugin) 同源直连
- 配置中心：defineMachReportConfig/defineMachReportPreset + provideMachReportConfig 路由级响应式叠加；优先级 props > 叠加 > preset > defaults > 内置缺省
- 全量文案（messages）与主题（theme → --mrp-* 变量）配置化
- ./async 异步插件入口 + preloadMachReport() 预载，组件拆独立分片
- 工程治理：引擎核心禁 import 子路径域的 eslint 边界规则；发布产物零依赖守卫测试
