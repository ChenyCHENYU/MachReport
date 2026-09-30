---
"@agile-team/mach-report": minor
---

README 重写 + 细粒度健壮性/集成体验：

- 插件默认注册全局组件 <MachReportPreview>（defineAsyncComponent 懒加载分片，globalComponent 可关）——像 mach-table 一样 app.use 后模板直接写组件
- useReportPreview() 编程式控制器（后代组件免模板 ref）；组件新增 overlay 默认插槽
- MachReportError 结构化错误（param/fetch/validate/render/pdf/print/config），error 事件新增第二参数 detail（契约向后兼容）
- createFetchRequest 内置 AbortController 超时（默认 30s）
- 打印重入忽略 + PDF 导出 in-flight 共享（并发点击不重复生成）
- createCanvasPager ResizeObserver 视口自适应；Canvas/Pager SSR 清晰报错
- loadFontWithCache 15s 超时回退；validateRenderPlan 规模告警（页数/组件数上限预警不阻塞）
