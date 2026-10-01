---
"@agile-team/mach-report": minor
---

出口矩阵补齐 + Node 无头导出通道（对齐并反超 jh4j 出口能力）：

- 图片导出：引擎 renderPlanToImages（png/jpeg、区间/dpr/质量、SSR 守卫）+ 工具栏"导出图片"（多页连续下载、并发去重）
- Word 导出：buildWordHtml（Word 兼容 HTML + office 命名空间 + Print 视图、named pages 尺寸保持）+ 工具栏"导出 Word"，可编辑 .doc 零后端
- Node 无头通道：font-loader 双环境（无 IndexedDB 降级内存缓存）；renderPlanToPdf/Xlsx 在 Node 18+ 可跑——定时任务/邮件推送/归档用同一引擎，服务端零渲染代码
- 新增 export 错误码（图片/Word 导出失败分类）
