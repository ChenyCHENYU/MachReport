---
"@agile-team/mach-report": minor
---

存量体检与根源修复（正确性缺陷 + 治理清零）：

- 修复日期字符串时区偏移（YYYY-MM-DD 按本地日历日解析，负时区不再少一天）
- 修复数值格式化显式精度被剥离；语义固化：digits 显式即精确保留、thousands 缺省 false
- 分组归组与数据到达顺序解耦（Map 归组，乱序数据不再产生重复组头/分段小计）
- 条件规则空值永不命中（杜绝 Number("")===0 陷阱）
- printPlans 补齐错误边界（onError + 失败立即回收 iframe）
- 搜索输入 200ms 防抖 + 打开自动聚焦；校验告警走可配置 logger（默认 console，可静默）
- LICENSE 补齐（对齐家族 Source-Available 1.0）+ license/author 字段
- 依赖漏洞清零：happy-dom/vitest 升级，uuid 经 workspace overrides 钉 ^11.1.1（内联进 ./xlsx 产物的依赖同受治理）
- 结构整洁：ReportPreview 拆分 useReportSearch/useThumbs/useDebugPanel/useLoadTiming；xlsx 死代码清除；性能预算阈值补并行负载余量
- 协作治理：AGENTS.md、pnpm release 一键发版、覆盖率配置
