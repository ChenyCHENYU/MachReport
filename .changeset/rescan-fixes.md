---
"@agile-team/mach-report": patch
---

复扫修复：搜索词变更旧高亮残留 + 套件抗抖治理：

- 高亮先清后套：查询从"钢"收窄到"钢板"不再嵌套两套 mark（仅清空才清除的缺陷修复，含回归测试）
- 卸载时清理防抖计时器
- 文档：README 补 logger 通道与格式化语义（digits 精确保留 / thousands 缺省 false / 本地日历日解析）
- vitest retry:1（负载敏感用例在并行重载下重试一次，阈值不放水）；异步挂载 waitFor 明确 5s 超时
