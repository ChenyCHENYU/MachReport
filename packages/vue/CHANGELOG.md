# @agile-team/mach-report-vue

## 0.2.0

### Minor Changes

- 7f145bd: 发布架构收敛为 mach-table 式单包（使用方从拼 4 个依赖变为装 1 个包）：
  
  - @agile-team/mach-report：引擎单包，合并 core/pdf/sql/manager 为子路径导出（./pdf ./sql ./manager），重依赖按需引入，tsc 直出全量类型
  - @agile-team/mach-report-vue：Vue 适配单包（vite lib 构建 + dts + style.css），依赖自动携带引擎，装这一个包即可使用 ReportPreview/插件/本地渲染
  - 旧的 mach-report-core/pdf/sql-engine/manager 四包已 deprecate，能力全部并入上述两个包

### Patch Changes

- Updated dependencies [7f145bd]
  - @agile-team/mach-report@0.4.0
