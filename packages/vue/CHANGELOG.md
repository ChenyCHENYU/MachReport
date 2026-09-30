# @agile-team/mach-report-vue

## 0.3.0

### Minor Changes

- aefcba8: 安装收敛到恰好 2 个包 + 配置化对齐 mach-table 体验：
  
  - 引擎零运行时依赖：tsup 四入口独立打包，pdf-lib/fontkit 内联 ./pdf 产物、node-sql-parser 内联 ./sql 产物；ESM+CJS 双格式 + .d.ts/.d.cts + engines node>=18（安装从 5 包降为 2 包）
  - PdfDocumentHandle：PDF 结果句柄不透明化，公共类型不再泄漏 pdf-lib
  - 零配置插件：内置 createFetchRequest（全局 fetch 适配），app.use(machReportPlugin) 同源直连
  - 配置中心：defineMachReportConfig/defineMachReportPreset + provideMachReportConfig 路由级响应式叠加；优先级 props > 叠加 > preset > defaults > 内置缺省
  - 全量文案（messages）与主题（theme → --mrp-* 变量）配置化
  - ./async 异步插件入口 + preloadMachReport() 预载，组件拆独立分片
  - 工程治理：引擎核心禁 import 子路径域的 eslint 边界规则；发布产物零依赖守卫测试

### Patch Changes

- Updated dependencies [aefcba8]
  - @agile-team/mach-report@0.5.0

## 0.2.0

### Minor Changes

- 7f145bd: 发布架构收敛为 mach-table 式单包（使用方从拼 4 个依赖变为装 1 个包）：
  
  - @agile-team/mach-report：引擎单包，合并 core/pdf/sql/manager 为子路径导出（./pdf ./sql ./manager），重依赖按需引入，tsc 直出全量类型
  - @agile-team/mach-report-vue：Vue 适配单包（vite lib 构建 + dts + style.css），依赖自动携带引擎，装这一个包即可使用 ReportPreview/插件/本地渲染
  - 旧的 mach-report-core/pdf/sql-engine/manager 四包已 deprecate，能力全部并入上述两个包

### Patch Changes

- Updated dependencies [7f145bd]
  - @agile-team/mach-report@0.4.0
