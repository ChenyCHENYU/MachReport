---
"@agile-team/mach-report": minor
---

报表语义层 + 交互完整面（对标社区报表插件差距收敛）：

- 列格式化：formatValue（千分位/小数位/百分比/日期 pattern），JSON 声明式，paginate 出口统一消费
- 页码占位符：{page}/{totalPages} 页锚组件（每输出页克隆注入、收尾回填总页数、模板零污染）
- 分组小计/总合计：groupBy（组头模板/组尾求和沿用列格式化/keepWithNext 防孤行）+ grandTotal
- 条件格式：列级声明式 rules（负数红字等），命中才克隆样式保持热路径驻留
- Excel 导出 ./xlsx 子路径（exceljs 内联）：网格→真表格（列宽/合并/样式直译），保真告警同 PDF
- 交互：Ctrl+滚轮缩放、PgUp/PgDn/Home/End/± 键盘、缩放 localStorage 记忆
- 预览搜索：全文索引→输入即定位→命中页 mark 高亮
- 缩略图侧栏：懒渲染小画布 + 点击导航；调试面板 ?mrp-debug=1（页窗/耗时/体积）
- 批量打印 printPlans：多计划合并单文档（named pages），一次打印对话框
