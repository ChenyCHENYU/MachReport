---
"@agile-team/mach-report": minor
---

参数面板：声明式查询条件，使用侧零表单代码（P3 项补齐）：

- ReportParamDef 模板自描述参数（text/number/date/select、必填/默认值/选项/占位）；builder .params() 链式声明
- ReportParamPanel 自动渲染查询面板：查询/重置/回车、必填红框（查询触发后才提示）、主题与文案全可配
- ReportPreview 集成：paramDefs prop > 模板 params；面板值与 props.params 合并后重载；show-params 走配置中心
- 根源修复：面板本地字典为唯一真相（连续填写多参数不丢值——props 快照合成会被并发事件覆盖）
- 必填缺失拦截查询并报 param 错误码；示例与 E2E 演示完整查询流
