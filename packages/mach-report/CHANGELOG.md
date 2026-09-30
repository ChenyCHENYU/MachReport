# @agile-team/mach-report

## 0.9.0

### Minor Changes

- e2a8462: 存量体检与根源修复（正确性缺陷 + 治理清零）：
  
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

## 0.8.0

### Minor Changes

- cc75619: 报表语义层 + 交互完整面（对标社区报表插件差距收敛）：
  
  - 列格式化：formatValue（千分位/小数位/百分比/日期 pattern），JSON 声明式，paginate 出口统一消费
  - 页码占位符：{page}/{totalPages} 页锚组件（每输出页克隆注入、收尾回填总页数、模板零污染）
  - 分组小计/总合计：groupBy（组头模板/组尾求和沿用列格式化/keepWithNext 防孤行）+ grandTotal
  - 条件格式：列级声明式 rules（负数红字等），命中才克隆样式保持热路径驻留
  - Excel 导出 ./xlsx 子路径（exceljs 内联）：网格→真表格（列宽/合并/样式直译），保真告警同 PDF
  - 交互：Ctrl+滚轮缩放、PgUp/PgDn/Home/End/± 键盘、缩放 localStorage 记忆
  - 预览搜索：全文索引→输入即定位→命中页 mark 高亮
  - 缩略图侧栏：懒渲染小画布 + 点击导航；调试面板 ?mrp-debug=1（页窗/耗时/体积）
  - 批量打印 printPlans：多计划合并单文档（named pages），一次打印对话框

## 0.7.0

### Minor Changes

- 712ff38: README 重写 + 细粒度健壮性/集成体验：
  
  - 插件默认注册全局组件 <MachReportPreview>（defineAsyncComponent 懒加载分片，globalComponent 可关）——像 mach-table 一样 app.use 后模板直接写组件
  - useReportPreview() 编程式控制器（后代组件免模板 ref）；组件新增 overlay 默认插槽
  - MachReportError 结构化错误（param/fetch/validate/render/pdf/print/config），error 事件新增第二参数 detail（契约向后兼容）
  - createFetchRequest 内置 AbortController 超时（默认 30s）
  - 打印重入忽略 + PDF 导出 in-flight 共享（并发点击不重复生成）
  - createCanvasPager ResizeObserver 视口自适应；Canvas/Pager SSR 清晰报错
  - loadFontWithCache 15s 超时回退；validateRenderPlan 规模告警（页数/组件数上限预警不阻塞）

## 0.6.0

### Minor Changes

- 587a5a2: 终态单包：一个包覆盖全部能力（目录架构 + 子路径导出替代分包）：
  
  - vue 适配层并入 `./vue` `./vue/async` `./vue/style.css` 子路径；vue 为 optional peer（非 Vue 宿主不安装框架）
  - 引擎主入口保持零框架耦合与零运行时依赖；自引用（self-reference）让 vue 子路径复用引擎产物、PDF 懒加载走 ./pdf
  - 统一 vite 六入口 × ESM/CJS 构建（含 .vue 类型声明与 .d.cts）
  - 旧的 @agile-team/mach-report-vue 已废弃：改为 `import { ReportPreview, machReportPlugin } from "@agile-team/mach-report/vue"`

## 0.5.0

### Minor Changes

- aefcba8: 安装收敛到恰好 2 个包 + 配置化对齐 mach-table 体验：
  
  - 引擎零运行时依赖：tsup 四入口独立打包，pdf-lib/fontkit 内联 ./pdf 产物、node-sql-parser 内联 ./sql 产物；ESM+CJS 双格式 + .d.ts/.d.cts + engines node>=18（安装从 5 包降为 2 包）
  - PdfDocumentHandle：PDF 结果句柄不透明化，公共类型不再泄漏 pdf-lib
  - 零配置插件：内置 createFetchRequest（全局 fetch 适配），app.use(machReportPlugin) 同源直连
  - 配置中心：defineMachReportConfig/defineMachReportPreset + provideMachReportConfig 路由级响应式叠加；优先级 props > 叠加 > preset > defaults > 内置缺省
  - 全量文案（messages）与主题（theme → --mrp-* 变量）配置化
  - ./async 异步插件入口 + preloadMachReport() 预载，组件拆独立分片
  - 工程治理：引擎核心禁 import 子路径域的 eslint 边界规则；发布产物零依赖守卫测试

## 0.4.0

### Minor Changes

- 7f145bd: 发布架构收敛为 mach-table 式单包（使用方从拼 4 个依赖变为装 1 个包）：
  
  - @agile-team/mach-report：引擎单包，合并 core/pdf/sql/manager 为子路径导出（./pdf ./sql ./manager），重依赖按需引入，tsc 直出全量类型
  - @agile-team/mach-report-vue：Vue 适配单包（vite lib 构建 + dts + style.css），依赖自动携带引擎，装这一个包即可使用 ReportPreview/插件/本地渲染
  - 旧的 mach-report-core/pdf/sql-engine/manager 四包已 deprecate，能力全部并入上述两个包

## 0.2.1

### Patch Changes

- 对齐 org 发布约定：publishConfig.access=public（与 @agile-team/mach-table 家族一致）。

## 0.2.0

### Minor Changes

- 4ee5de1: 规模化与架构收敛轮（Canvas 内存模型 / 热路径分配 / 样式单源 / 使用侧精简；vue 插件与组件拆分随 workspace 源码消费，不单独发版）：
  
  - core：Canvas 窗口化分页器 createCanvasPager（视口窗口 + 画布池复用 + 每帧限量分帧渲染，大报表内存从 O(总页数) 降到 O(窗口)；A4@dpr2 约 14MB/页全量渲染不再可行）；renderPlanToCanvas 支持 start/end 页区间
  - core：分页热路径驻留优化——列样式/边框样式对象每列表只构造一次（万行级对象分配清零）；charWidthEm 改 ASCII 查表（无逐字符正则）；5k 行分页稳定 ~57ms
  - core：TextMeasurer 注入接口（启发式默认 + createCanvasMeasurer 浏览器校准），分页/Canvas/PDF 可共用同一测量器消除三端折行差异
  - core：共享样式解析模块 render/style.ts（字号/描边/行高/边框开关三后端单源）+ defaults.ts 常量集中；grid-geometry 新增 span 感知 edges（合并单元格中间不再画线）
  - core：ListComponent.border=false 在三后端真正生效；DOM 表格补内网格线（td 边框 + border-collapse）；builder 支持 .page("a4", { landscape }) 纸张预设
  - pdf：接入共享样式/edges/测量注入；named page 边框/线宽与 Canvas 一致
  - vue：machReportPlugin 插件（request/fetcher/pdfExporter 一次注入，业务侧 <ReportPreview temp-id> 一行使用）；组件拆分 composables（usePageWindow/useZoom/usePrintExport）+ ReportToolbar；CSS 变量主题（--mrp-*）；打印流式分块写入 iframe（大报表无长任务）+ named pages 混合纸张；gapPx 可配置
  - 工程：纯逻辑测试分流 node 环境（套件时长 -44%）；core/sql-engine/manager/pdf 具备 dist 产物与 publishConfig；vue/federation 标记 private（待 vite lib 构建后开放）；全包 sideEffects:false

### Patch Changes

- 4ee5de1: 三后端一致性与工程化优化轮（vue/federation 层的对应变更随 workspace 源码消费，不单独发版）：
  
  - core：修复 Canvas 后端 Y 轴垂直镜像与字号换算系数错误（与 DOM/PDF 统一顶点原点坐标系、ptToPx 同源换算）；新增共享网格几何模块（colWidthsMm/rowHeightsMm/colSpan/rowSpan 统一解析，DOM/Canvas/PDF 三后端复用）；wrapText 拉丁词不再拦腰截断；computePageWindow 支持 gapPx 并改前缀和+二分；paginate 透传左右边距；DOM 渲染器清理死代码/重复样式写入并应用 rowHeightsMm
  - vue：reload 代际令牌根治快速切换 tempId 的竞态覆盖；缩放改 transform: scale（零重排）并统一虚拟化坐标系；打印 HTML 去 regex 化（outerHTML 序列化）；新增导出 PDF（懒加载 @agile-team/mach-report-pdf）与导出 HTML 双入口；PDF 窗口改 blob URL
  - pdf：网格渲染接入共享几何与单元格样式（对齐/底色/字号/折行）；富文本降级导出并计入保真告警（fidelityWarnings）；支持 data URL PNG/JPG 图片嵌入；文本按宽度折行
  - sql-engine：# 行注释剥离（不影响 #{ 绑定）；关键字校验剥离字符串字面量防误伤
  - manager：holdLock 心跳连续失败触发 onLockLost（锁丢失感知）
  - 工程：root type:module；lint any 清零；CI 改 ubuntu 并上传 HTML 报告；core/sql-engine/manager 具备 dist 产物构建与 publishConfig；E2E 新增 Canvas 结构化像素断言（Y 轴/几何回归门）与缩放后翻页断言
