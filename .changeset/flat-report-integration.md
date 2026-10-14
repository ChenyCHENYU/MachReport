---
"@agile-team/mach-report": minor
---

新增框架无关 createReportSource 与类型化 defineReport，支持插件 reports 一次注册模板和业务取数，包内完成分页、校验、告警和有序多报表合并，自动读取模板参数。Vue 入口重导出核心 API，并新增 useMachReport 父页面控制句柄。完善请求取消与完整响应超时、配置字段继承、异步注册开关，以及可等待的导出、并发去重和卸载清理；保留旧 fetcher、本地适配器及组件控制入口。
