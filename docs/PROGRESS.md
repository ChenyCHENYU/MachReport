# MachReport 迭代进度日志

> 通宵自主执行模式 · 每个闭环 = 实现 → 测试 → 验证 → 检查点提交
> 验证命令：`pnpm typecheck && pnpm lint && pnpm test && pnpm exec playwright test`

## 优化轮 15（2026-10-02 · 多模板真实契约验收准备）

真实契约测试原先固定 Node 环境，样本一旦存在就会因缺少 `document` 而失败；现已改为浏览器 DOM 模拟环境，并支持逐张读取多份 `gridplan-real*.json`。采集工具要求显式传入已发布的 `tempId`，按模板分别保存忽略提交的样本，避免默认 ID 和覆盖前一张样本。两份临时模拟样本已验证 10 项契约断言均执行通过，随后已清除；这不计作真实环境验收。文档中的报表平台地址从当前环境连接超时，仍需可访问的环境或脱敏样本。

## 优化轮 14（2026-10-02 · 对标后的接入与验收收敛）

| 项 | 改动 | 验收口径 |
|---|---|---|
| 网关与参数 | 修复内置 fetch 双重 `baseUrl`；模板 ID 防参数覆盖；响应缺 `pages` 显式报错；宿主参数变更同步面板、清空可选项生效 | 插件/适配器/面板回归用例 |
| 导出与打印 | Vue 接通 XLSX、未知格式拒绝、PDF 窗口嵌入真实 PDF；中文缺字阻止残缺导出；导出进度及保真告警可见；打印逐页渲染 | 单测与浏览器下载（PDF `%PDF-`、XLSX `PK`） |
| 配置与采集 | 页间距运行时响应；字体 URL 按配置层解析；真实 gridPlan 抓取路径修正、响应校验、样本忽略提交 | 类型/规范/构建门禁；真实 SIT 样本仍需登录采集 |
| 对标文档 | README/API 校正能力与性能口径，增加 `docs/comparison-and-acceptance.md` | 按真实业务模板逐张对照 jh4j PDF 后再宣布替换能力 |

本轮自动化测试覆盖代码回归和本地演示；没有 SIT 登录时真实契约测试会跳过，不将其计为现网兼容验收通过。

## 优化轮 13b（2026-10-01 · README 质感收敛，发版 1.1.1）

| # | 项 | 内容 |
|---|---|---|
| 133 | 去 decoration | 标题/折叠摘要全部去 emoji 装饰符，回归纯排版层级（高级质感=克制）；导航锚点同步 |
| 134 | 过期信号清理 | 正文手写版本号/迭代轮次移除（npm 徽章动态显示，永不过期）；路线图状态改文字 |
| 135 | npm 包页 README 同步 | prepublishOnly 自动拷贝根 README 进包（包页与 GitHub 一致；产物 gitignore） |

## 优化轮 13（2026-10-01 · 出口矩阵补齐 + Node 无头通道，252 单测 + 13 E2E 双轮全绿，发版 1.1.0）

**动因**：对齐并反超 jh4j 出口能力（Word/图片此前缺失）；解锁服务端场景（同引擎两端执行，非另写渲染）。

| # | 项 | 产出 |
|---|---|---|
| 127 | **图片导出** | 引擎 `renderPlanToImages`（png/jpeg、区间/dpr/质量、SSR 守卫）；组件"导出图片"按钮（多页 page-N.png 连续下载，in-flight 去重） |
| 128 | **Word 导出** | `buildWordHtml`（Word 兼容 HTML + office 命名空间 + Print 视图，named pages 尺寸随行）；"导出 Word"按钮产出可编辑 .doc，零后端 |
| 129 | **Node 无头通道** | font-loader 双环境（无 IndexedDB 自动降级内存缓存 + fetch）；Node 实测 PDF 产出合法——定时任务/归档用同一引擎 |
| 130 | 错误码扩展 | 新增 `export` 错误码（图片/Word/Excel 导出失败分类） |
| 131 | 测试 | 单测 +6（图片守卫/字体双环境/无头 PDF/Word 头与分页规则/出口矩阵接线）；E2E +1（真实下载事件 png/doc，谓词消解多页竞态）；连续两轮零重试全绿 |
| 132 | 发版 | 1.1.0 |

> 管理端控制台 UI 与设计器按建议独立立项（下轮专项）。

## 优化轮 12（2026-10-01 · README 质感重制，发版 1.0.1）

| # | 项 | 内容 |
|---|---|---|
| 123 | **logo 徽标** | `assets/mach-report-logo.svg`：文档+表格图形 + Mach 家族字标 + 管线三出口（屏幕→PDF→打印）——对齐 mach-table 的 `assets/` 惯例与 raw URL 引用方式 |
| 124 | **README 重制** | 居中 logo + 五徽章（npm/CI/零依赖/node/license）+ 浓缩定位；快速开始三段式；核心能力六域表；九大深度区折叠（单包架构/集成姿势/配置中心/DSL/数据面/引擎API/性能/迁移/打印指引/架构门禁）——首屏一目了然，深度按需展开 |
| 125 | 路线图区块 | v1.0 已交付清单 + 设计器/控制台独立立项 + 远期项 |
| 126 | 发版 | 1.0.1（npm 包页同步新 README） |

## 优化轮 11（2026-10-01 · 定版终审，246 单测 + 12 E2E 全绿，发版 **1.0.0**）

| # | 项 | 内容 |
|---|---|---|
| 120 | setParams 编程式设参 | controller/expose 新增 `setParams(values, { reload? })`：宿主按钮"查本仓库"类场景免面板操作，面板同步显示新值 |
| 121 | 冗余与文档失真清扫 | README"9 specs"过期数字移除；本地模式参数面板用法补 `:param-defs="template.params"` 指引；useReportSearch 文件头注释对齐四 composable 实况；AGENTS 未了项刷新（P3 清空、token 提醒） |
| 122 | 定版 | 0.x 十版收敛 → **1.0.0**：API 面冻结基线，后续按语义化版本演进 |

## 优化轮 10（2026-10-01 · 参数面板：P3 最后一块补齐，245 单测 + 12 E2E 全绿，发版 0.10.0）

**动因**：用户要求把"还没有的"做实——参数面板是其中最适合本轮做扎实的（设计器/管理控制台为多轮工程，见下）。

| # | 项 | 产出 |
|---|---|---|
| 114 | **ReportParamDef 声明** | 模板自描述参数（field/label/type=text·number·date·select/options/defaultValue/required/placeholder）；builder `.params([...])` 链式 |
| 115 | **ReportParamPanel 组件** | 自动渲染查询面板：四类控件、必填红框（查询触发后才提示）、查询/重置、回车查询；主题与文案全走 --mrp-*/messages |
| 116 | ReportPreview 集成 | `paramDefs` prop > 模板 params；面板值 > props.params 合并；必填拦截报 param 错误码；show-params 走配置中心 |
| 117 | **根源修复** | 面板以本地字典为唯一真相整体上抛——连续填写多参数不丢值（props 快照合成会被并发事件覆盖，"先选仓库再填关键字丢仓库"） |
| 118 | 测试与演示 | 6 单测（渲染/合并/必填/重置/关闭/覆盖）+ builder params 用例 + E2E 查询流；示例页带面板演示 |
| 119 | 范围决策 | 设计器（拖拽画布/撤销/属性树）与管理控制台 UI 属多轮工程，不塞本轮仓促交付——分期方案见 README 里程碑 |

## 优化轮 9b（2026-09-30 · 终扫修复，238 单测 + 11 E2E 双轮全绿，发版 0.9.1）

| # | 项 | 修复 |
|---|---|---|
| 111 | 搜索高亮残留 | 查询变更先清后套（"钢"→"钢板"不再嵌套两套 mark）+ 回归测试；卸载时清理防抖计时器 |
| 112 | 套件抗抖 | vitest `retry: 1`（负载敏感用例重试一次，阈值不放水）；异步挂载 waitFor 明确 5s；连续两轮全绿验证 |
| 113 | 文档补口 | README 补 logger 通道与格式化语义（digits 精确保留 / thousands 缺省 false / 本地日历日解析） |

## 优化轮 9（2026-09-30 · 存量体检与根源修复，237 单测 + 11 E2E 全绿）

**动因**：不扩展功能，专项清理 8 轮快速迭代累积的正确性/治理/整洁债（对照体检清单逐项根治）。

| # | 项 | 根源修复 |
|---|---|---|
| 94 | **日期时区 bug** | `new Date("YYYY-MM-DD")` 按 UTC 零点（负时区少一天）→ `parseDateLocal` 手工按本地日历日解析 |
| 95 | **精度剥离 bug** | thousands:false 分支 `replace(/\.?0+$/)` 误裁显式 digits → 语义固化：digits 显式即精确保留；thousands 缺省 false（文档+测试锚定） |
| 96 | **分组顺序依赖** | 顺序扫描切组（乱序数据重复组头）→ Map 归组保首现顺序，排序不再前提（乱序回归测试） |
| 97 | **printPlans 无错误边界** | 与 print() 对齐：onError 回调 + finally 立即回收失败 iframe（成功路径 60s 后回收） |
| 98 | **空值规则陷阱** | `Number("")===0` 使空值命中数值规则 → evalStyleRule 空值永不命中（测试锚定） |
| 99 | 搜索抖动 | 逐键 O(全计划) 扫描+跳页 → 200ms 防抖（清空立即生效）+ 工具栏打开自动聚焦 |
| 100 | 日志可观测性 | console.warn 硬编码 → config.defaults.logger（默认 console，SILENT_LOGGER 可静默） |
| 101 | debug 面板性能 | JSON.stringify 随窗变化重算 → planKB 仅依赖 plan 引用缓存 |
| 102 | **LICENSE 补齐** | 对齐家族（mach-table Source-Available License 1.0，书面授权制）+ package.json license/author 字段 |
| 103 | **依赖漏洞清零** | happy-dom ^20.8.9 / vitest ^4.1.11 升级；uuid 经 exceljs（内联进发布物）以 workspace overrides 钉 ^11.1.1——`pnpm audit` 全绿（prod+dev） |
| 104 | workspace 修复 | pnpm-workspace.yaml 的 allowBuilds 残留占位清除；overrides 迁至 pnpm 11 新家 |
| 105 | 测试去抖 | perf-budget 两处阈值补并行负载余量（80→120ms/页、30→50ms/窗，单机实测远低于此） |
| 106 | 覆盖率配置 | vitest coverage（v8 provider，聚焦 layout/render/format）+ test:coverage 脚本 |
| 107 | 结构整洁 | ReportPreview 640→~430 行（useReportSearch/useThumbs/useDebugPanel/useLoadTiming 抽取）；render-xlsx gridOf 死助手+重复合并条件清除；usePageWindow 返回面收敛；paginate 尾部重复再导出删除 |
| 108 | errorPrefix | 标记 @deprecated（类型兼容保留，下个大版本移除） |
| 109 | 协作治理 | AGENTS.md（命令/架构地图/发布流程/红线）；根 `pnpm release` 一键发版脚本；README 去魔法数字 |
| 110 | 发版 | mach-report 0.9.0 |

> 未了项：npm token 轮换（用户操作）；repository/homepage 待 git remote；契约 fixture 待采集。

## 优化轮 8（2026-09-30 · 报表语义 + 交互完整面，232 单测 + 11 E2E 全绿）

**动因**：对标 mach-table 与社区报表插件（hiprint/Stimulsoft/print-js）扫描——差距集中在报表语义层与交互细节。

| # | 项 | 产出 |
|---|---|---|
| 82 | **列格式化** | `formatValue`（千分位/小数位/百分比/日期 pattern，JSON 声明式不破坏契约）；paginate 出口统一消费，三后端零感知 |
| 83 | **页码占位符** | `{page}/{totalPages}` → 页锚组件：每输出页克隆注入、收尾回填总页数、模板对象零污染 |
| 84 | **分组小计/总合计** | groupBy（组头跨全列 + headerTemplate、组尾数值求和沿用列格式化、keepWithNext 防孤行）+ grandTotal；纯 plan 层增强 |
| 85 | **条件格式** | 列级声明式 rules（field/op/value → style 合并）；命中才克隆样式，未命中行保持驻留引用（热路径零分配） |
| 86 | **Excel 导出** | `./xlsx` 子路径（exceljs 内联）：网格→真表格（resolveGridLayout 复用单真相源几何：列宽 mm 直译/colSpan 合并/底色加粗对齐）、文本→合并标题行、保真告警同 PDF 口径 |
| 87 | **交互手势** | Ctrl+滚轮缩放（30%~300%）、PgUp/PgDn/Home/End/± 键盘、缩放模式 localStorage 记忆恢复 |
| 88 | **预览搜索** | 计划全文索引（文本+网格）→ 输入即定位 → 命中页 mark 高亮（TreeWalker 包裹/清除） |
| 89 | **缩略图侧栏** | 懒渲染小画布（IntersectionObserver + dpr 0.2）、当前页指示、点击导航；无 2D 环境保留占位 |
| 90 | 调试面板 | `?mrp-debug=1`/debug prop：页窗区间/加载耗时/计划体积悬浮窗 |
| 91 | **批量打印** | `printPlans(plans)`：多计划合并单文档（named pages 混合纸张），一次打印对话框，onProgress 进度 |
| 92 | 打印兼容指引 | README 收录背景图形/named pages 内核/iOS WebView/字体缓存四类实战排障 |
| 93 | 发版 | mach-report 0.8.0 |

## 优化轮 7（2026-09-30 · README 重写 + 细粒度健壮性/集成体验，212 单测 + 9 E2E 全绿）

**动因**：README 结构化（看的人懂定位、用的人能抄代码）；代码层细粒度打磨——对齐 mach-table 的插件式快速集成。

| # | 项 | 产出 |
|---|---|---|
| 73 | **README 全面重写** | 30 秒接入（3 行代码）/特性总览/配置中心/组件与数据面 API 表格/管线图/架构图/性能表/jh4j 迁移表 |
| 74 | **全局组件注册** | 插件默认注册 `<MachReportPreview>`（defineAsyncComponent 懒加载分片，首屏零成本；`globalComponent: false` 可关）——模板直接写组件，不再每页 import |
| 75 | **useReportPreview()** | 后代组件免模板 ref 的编程式控制器（reload/print/exportAs/openPdfWindow/gotoPage）；组件新增 overlay 默认插槽（自定义操作按钮/徽标） |
| 76 | **结构化错误** | MachReportError（code: param/fetch/validate/render/pdf/print/config）；error 事件第二参数 detail（契约向后兼容） |
| 77 | 请求超时 | createFetchRequest 内置 AbortController 超时（默认 30s，明确"请求超时(Nms)"语义） |
| 78 | 导出防抖 | print 重入忽略（防连点多打印 iframe）；exportPdf in-flight 共享（不重复生成 9MB 字节流） |
| 79 | 渲染健壮性 | createCanvasPager ResizeObserver 视口自适应（弹窗开合/分栏拖动重算窗口）；canvas/pager SSR 清晰报错 |
| 80 | 字体与规模守卫 | loadFontWithCache 15s 超时回退；validateRenderPlan 规模告警（>2000 页 / >5 万组件预警不阻塞） |
| 81 | 发版 | mach-report 0.7.0 |

## 优化轮 6（2026-09-30 · 终态单包：一个包覆盖全部能力，205 单测 + 9 E2E 全绿）

**动因**：用户决策——目录架构 + 子路径导出替代分包，消灭多包版本同步/双 CHANGELOG/跨包依赖的维护成本。

| # | 项 | 产出 |
|---|---|---|
| 68 | **单包合并** | vue 适配层源码并入引擎包 `src/vue/`（子路径域）；workspace 3 包 → 2 包（mach-report + federation 内部件）；npm 只剩 `@agile-team/mach-report` 一个包 |
| 69 | **框架零耦合保证** | `./vue` `./vue/async` `./vue/style.css` 子路径导出；vue 声明为 **optional peer**（pnpm/npm 均不给非 Vue 宿主自动装 vue）；eslint 边界规则扩至禁 core→vue；产物守卫断言主入口零 vue import |
| 70 | **自引用（self-reference）** | vue 入口静态依赖引擎、PDF 懒加载 `./pdf` 均走包名自引用——运行时经本包 exports 解析，引擎代码全局单份、构建外部化零内联 |
| 71 | 统一构建 | 六入口（index/pdf/sql/manager/vue/vue-async）× ESM/CJS 单 vite 构建（tsup 退役）；dts 含 .vue 声明 + 入口级 .d.cts；style.css 单一样式出口 |
| 72 | 发版 | mach-report 0.6.0；mach-report-vue（0.2.0/0.3.0）deprecate 指向 `@agile-team/mach-report/vue` 并从 npm 删除 |

## 优化轮 5（2026-09-30 · 安装收敛到 2 包 + 配置化对齐 mach-table，201 单测 + 9 E2E 全绿）

**动因**：对标审查发现安装为 5 个实体包（table 为 2 个），且插件配置面不及 mach-table-vue 的 defineConfig/presets/async 体验。

| # | 项 | 产出 |
|---|---|---|
| 60 | **引擎零运行时依赖** | 构建从 tsc 切换 tsup 四入口独立打包：pdf-lib/fontkit 内联进 `./pdf` 产物（2.1MB）、node-sql-parser 内联进 `./sql`（4.0MB）、主入口 56KB 纯引擎；ESM+CJS 双格式 + .d.ts/.d.cts 双声明 + engines node>=18。**安装从 5 包 → 恰好 2 包** |
| 61 | PdfDocumentHandle | PdfRenderResult.pdfDoc 改为不透明句柄（save()），公共类型面不再泄漏 pdf-lib 类型 |
| 62 | **零配置插件** | 内置 createFetchRequest（全局 fetch 适配，含 query/头/credentials/错误语义）；`app.use(machReportPlugin)` 无任何 options 即同源直连 jh4j 端点 |
| 63 | **配置中心** | defineMachReportConfig/defineMachReportPreset（defaults/presets/defaultPreset）+ provideMachReportConfig 路由级响应式叠加 + useMachReportConfig；优先级 props > 叠加 > preset > defaults > 内置缺省（对齐 mach-table 约定）；组件显隐/gapPx/文案 props 缺省改走配置解析 |
| 64 | 文案与主题配置化 | MachReportMessages 全量文案（title/翻页/导出/打印/loading/空态/重试，{cur}/{total} 模板）+ MachReportTheme 十项 --mrp-* 变量注入组件外壳 |
| 65 | **./async 异步入口** | machReportAsyncPlugin 注册全局组件 MachReportPreview（defineAsyncComponent 独立分片）+ preloadMachReport() 预载；构建出双入口 index/async × ESM/CJS |
| 66 | 工程治理 | eslint 边界规则（引擎核心禁 import pdf/sql/manager 域）；发布守卫测试（引擎零 dependencies + 四入口×双格式×双声明 + 主入口不含 pdf-lib；vue 分片外部化断言）；sideEffects 对齐 table 风格；CHANGELOG 头对齐 |
| 67 | 发布 | mach-report 0.5.0 / mach-report-vue 0.3.0：registry 验证零 dependencies |

## 优化轮 4（2026-09-30 · 发布架构收敛为 mach-table 式单包，183 单测 + 9 E2E 全绿）

**动因**：此前 core/pdf/sql-engine/manager 各发一个 npm 包，使用方要自己拼 4 个依赖，维护与心智成本高；对标 mach-table 家族"装一个包就行"的集中设计。

| # | 项 | 产出 |
|---|---|---|
| 55 | **引擎单包 `@agile-team/mach-report`** | core+pdf+sql+manager 源码物理合并（src/{pdf,sql,manager}/ 子目录），exports 主入口 + `./pdf` `./sql` `./manager` 子路径（重依赖 pdf-lib/node-sql-parser 仅子路径引入）；tsc 单构建直出 4 份 d.ts+js |
| 56 | **Vue 适配单包 `@agile-team/mach-report/vue`** | vite lib 构建（ES 单入口 + dist/style.css 样式出口 + vite-plugin-dts 含 .vue 类型）；vue 与引擎外部化，PDF 懒加载保留为运行时子路径导入；**装这一个包 = 全家桶**（依赖自动携带引擎） |
| 57 | workspace 收敛 | packages 6 → 3（mach-report / mach-report-vue / federation），根 tsconfig 引用与全仓 import 同步收敛 |
| 58 | 发布产物守卫 | 新增单包契约冒烟测试（主入口/子路径 API 面 + node 环境全量可加载=SSR 安全）；vue 发布产物测试（外部化断言 + d.ts/style.css 存在性 + 不含测试声明） |
| 59 | npm 治理 | 旧 4+4 包（mach-report-core/pdf/sql-engine/manager 与首批泛名包）全部 deprecate 指向 `@agile-team/mach-report`；新包 `publishConfig.access=public` |

> 联调口径：examples 已切到单包依赖（`@agile-team/mach-report` + `@agile-team/mach-report/vue`）。

## 优化轮 3（2026-09-30 下午 · 规模化与架构收敛，175 单测 + 9 E2E 全绿，发版 @agile-team 0.2.x）

| # | 项 | 产出 | 验证 |
|---|---|---|---|
| 42 | **Canvas 内存模型修复（P0）** | `createCanvasPager`：视口窗口（与 DOM 共用 computePageWindow）+ 画布池复用 + 每帧限量分帧；A4@dpr2 ≈14MB/页，全量渲染百页级必炸，窗口化后内存 O(窗口) | 新 E2E：画布数 ≤ 池上限、滚动后不增长、滚动高度为全量 |
| 43 | **分页热路径驻留（P0）** | 列样式/边框样式每列表构造一次（`interList`），行级零新对象；`charWidthEm` ASCII 查表 | 单测：同列共享样式引用；5k 行 57ms |
| 44 | TextMeasurer 注入 | 启发式默认 + `createCanvasMeasurer`（无 2D 环境自动回退）；paginate/Canvas/PDF 可共用同一实例 | 单测：注入加倍测量器 → 行高增大 |
| 45 | 样式解析单源 | `render/style.ts`（字号/描边/行高/边框开关）+ `defaults.ts` 常量集中，三后端消费 | lint/typecheck |
| 46 | span 感知 edges | grid-geometry 导出内部线段（跳过合并单元格），Canvas/PDF 消费 | 单测：colSpan/rowSpan 边界断言 |
| 47 | border=false 生效 | 三后端统一走 resolveBoxBorders；DOM 表格补 td 内网格线（border-collapse） | 单测 + 快照回归 |
| 48 | builder 纸张预设 | `.page("a4", { landscape, margins })`，兼容旧数字签名 | 单测（resolvePaper） |
| 49 | **Vue 插件** | `machReportPlugin`：request/fetcher/pdfExporter 一次注入；ReportPreview 无 prop fetcher 时自动落到注入值 | 单测：request 组装/优先级/本地注入渲染 |
| 50 | 组件拆分 | usePageWindow/useZoom/usePrintExport + ReportToolbar；CSS 变量主题（--mrp-*）；gapPx 可配 | 既有组件测试全绿 |
| 51 | 打印流式 + named pages | 打印 HTML 分块写 iframe（每 8 页让出主线程）；混合纸张按尺寸分组 @page 规则 | 单测（buildPrintDocument）+ E2E 复验 |
| 52 | pdf 包 | 接入 style/edges/measurer；tsconfig.build + publishConfig（可发布） | build ✓ 单测 ✓ |
| 53 | 工程效率 | 纯逻辑测试分流 node 环境（环境启动 141s→52s，套件 -44%）；sideEffects:false；vue/federation 标 private | 全门禁 |
| 54 | 发版 | changesets version → core/pdf 0.2.0、sql-engine/manager 0.1.1；npm 发布四个 dist 就绪包 | npm publish |

> 本轮遗留（roadmap）：绘制指令 IR（DisplayList）统一三后端、PDF save Worker 化、params 变更 keyed 局部补绘、vue/federation 的 vite lib 发布构建。

## 优化轮 2（2026-09-30 · 三后端一致性 + 工程化，156 单测 + 8 E2E 全绿）

| # | 项 | 产出 | 验证 |
|---|---|---|---|
| 30 | **Canvas Y 轴镜像修复** | `render/canvas.ts` 改顶点原点（与 DOM/PDF 一致），修订单真相源最大破绽 | 新 E2E：已知位置红色块 + 镜像位白（结构化像素断言） |
| 31 | **Canvas 字号系数修复** | pt→px 走 `units.ptToPx` 同源换算（原实现大 2.13×），`planFontSizePx` 导出可单测 | typecheck + E2E |
| 32 | **共享网格几何模块** | `render/grid-geometry.ts`：colWidthsMm/rowHeightsMm/colSpan/rowSpan/稀疏 null 单元格统一解析，Canvas/PDF 复用（DOM 保留 table 语义 + rowHeightsMm） | 7 个单测 |
| 33 | **reload 竞态防护** | 代际令牌（reloadSeq）：快速切换 tempId 旧请求后返回不覆盖新数据 | 新单测（STALE 后返回不覆盖 FRESH） |
| 34 | **缩放改 transform: scale** | 外层占位 + 内层 transform（零重排、跨浏览器）；虚拟化坐标系统一（scrollTop/zoom、gapPx 计入占位） | E2E：150% 缩放矩阵断言 + 缩放后翻页 |
| 35 | **PDF 保真增强** | 单元格样式（对齐/底色/字号/折行）、富文本降级导出、data URL PNG/JPG 嵌入、`fidelityWarnings` 保真告警上报 | 3 个新单测 |
| 36 | sql-engine 严谨化 | `#` 行注释剥离（排除 `#{`）；关键字校验剥离字符串字面量（`'put into box'` 不再误伤） | 3 个新单测 |
| 37 | manager 锁丢失感知 | holdLock 心跳连续失败（默认 2 次）→ onLockLost 回调并停止心跳 | 2 个新单测（fake timers） |
| 38 | print/PDF 窗口清理 | 打印 HTML 走 outerHTML 序列化（去 regex hack）；PDF 窗口 blob URL + 弹窗拦截提示 | E2E 复验 |
| 39 | vue 导出双入口 | 「导出 HTML / 导出 PDF」按钮；PDF 走懒加载 @agile-team/mach-report/pdf（不影响主包体积），新增 pdfFontUrl prop | E2E + typecheck |
| 40 | 工程化 | root `type:module`；lint any 清零；CI ubuntu + HTML 报告 artifact；core/sql-engine/manager 真实 dist 构建（tsconfig.build.json + publishConfig + files，产物不含测试） | `pnpm -r build` ✓ |
| 41 | 性能增量 | computePageWindow 前缀和+二分（gapPx 口径）；paginate cellText 双调用消除；font-loader 并发去重（in-flight 共享） | window 单测 + 既有预算门 |

> 本轮遗留：vue/pdf/federation 的 npm 发布构建（vite lib mode + dts）；Canvas/PDF 的 rotateDeg/opacity 支持；gridPlan 真实契约 fixture 仍待登录激活。

## 最终交付状态（2026-09-17 03:05 · 值守至 06:00）

- **28 个检查点提交 · 6 个包 · 131 单测 + 4 真浏览器 E2E 全绿**
- typecheck（tsc + vue-tsc SFC）/ lint 0 错误
- core / sql-engine / vue / federation（remoteEntry 产物）/ manager / pdf
- jh4j 兼容三件套：gridPlan 适配器 + 模板导入转换器 + expose 契约对齐
- **PDF 前端直出已落地**（pdf-lib + fontkit 中文子集嵌入，E2E 真实下载断言）
- **AST 级 SQL 校验已落地**（node-sql-parser MySQL 方言，方言失败自动降级词法）

| 检查点时间线 | commit | 内容 | 验证 |
|---|---|---|---|
| 1 | 00:46 | e5061d6 | 脚手架 + core v0.1（schema/units/textwrap/paginate/DOM 渲染器） | 28 tests |
| 2 | 01:30 | a4cb69b | sql-engine v0.1（三语法编译 + 表达式求值 + 单 SELECT 校验） | 49 tests |
| 3 | 01:37 | fe39161 | vue v0.1 契约组件 + jh4j/local 双适配器 | 59 tests |
| 4 | 01:45 | 9bebaba | example 构建（gzip 34KB）、typecheck 收敛 | build ✓ |
| 5 | 01:52 | 7ddd415 | core v0.2 视口虚拟化 + 性能预算门 | 70 tests |
| 6 | 02:10 | — | designer chunk 逆向（模板 JSON + 锁 API） | docs |
| 7 | 02:20 | — | RenderPlan 校验器（JSON path 行级定位） | 81 tests |
| 8 | 02:30 | — | eslint 质量门（flat config，0 errors） | lint ✓ |
| 9 | 02:45 | — | federation 入口包（expose 契约对齐） | 85 tests |
| 10 | 03:00 | — | jh4j 模板导入转换器（逆向 schema 驱动） | 90 tests |
| 11 | 03:15 | — | Playwright 真浏览器 E2E ×3 | e2e ✓ |
| 12 | 03:35 | — | 边界补强（嵌套 if/转义/200 条件/万行冒烟） | 106 tests |
| 13 | 03:50 | — | federation 可部署构建（remoteEntry + 产物守卫） | 109 tests |
| 14 | 04:10 | — | 字体模型校准（Chromium 实测数据驱动） | 109 tests |
| 15 | 04:20 | — | vue-tsc SFC 类型检查（抓出 1 个真 bug）+ 打印分页保护 | 全绿 |
| 16 | 04:55 | — | manager 包：管理端 API 客户端（模板/数据集/参数/导入导出/模板锁 holdLock） | 116 tests |
| 17 | 02:55* | — | template builder DSL（类型化链式建模板） | 121 tests |
| 18 | 03:10* | — | PDF 前端直出包（fontkit 中文子集）+ E2E 下载断言 | 125 tests |
| 19 | 03:00* | — | AST 级 SQL 校验（node-sql-parser + 词法双保险） | 131 tests |

（* 为机器本地时间 HH:mm；同一夜内机器时间与日志序号不完全单调，以 git 顺序为准）

> **值守收尾（05:55）**：三轮自动巡查（04:05 文档补强 / 05:05 example 懒加载优化 / 05:55 终验）全部通过——typecheck+lint 0 错误、131 单测 + 4 E2E 全绿、32 个检查点提交、git 工作区干净。夜间值守结束，等待日间指令。

---

## 日间优化轮（2026-09-17 上午 · 用户授权"优化这些"）

| # | 项 | 产出 | 验证 |
|---|---|---|---|
| 20 | **P0-1** 真实 gridPlan 联调工具链 | `scripts/fetch-gridplan.mjs`（人工登录一次→自动抓取 fixture）+ `real-contract.test.ts`（fixture 存在即激活 5 项契约守卫，缺失时优雅跳过） | 5 skipped → 待登录激活 |
| 21 | **P0-2** federation 宿主 harness | `examples/fed-host`：复刻 wl-ui-produce 的 `virtual:__federation__` 动态 setRemote 机制 + mock 网关回源 remoteEntry 产物 | 2 E2E 全过 |
| 22 | **关键 bug 修复** | InjectionKey 由裸 Symbol 改字符串——**symbol 跨 federation 边界不相等**导致 inject 必然失效（真接 wl-ui-produce 也会踩），E2E 实证修复 | e2e 复验 |
| 23 | **P1** Canvas 渲染后端 | `renderPlanToCanvas`（位图页、dpr 缩放、缩放零重排）+ example 演示按钮 | 真 Chromium 像素统计 E2E |
| 24 | **P2** CI 流水线 | `.github/workflows/ci.yml`（typecheck/lint/test/build/e2e 全门） | 待推送验证 |
| 25 | **P2** 字体持久缓存 | `loadFontWithCache`（IndexedDB + 内存，simhei 9MB 只拉一次） | E2E 复验 |
| 26 | **P2** changesets 版本管理 | `.changeset/config.json` + `pnpm changeset/version` 脚本 | 配置就绪 |

> 性能预算门随机器负载抖动放宽至 80ms/页（防数量级回归的口径不变）。

最终：**136 单测 + 7 E2E 全绿 · typecheck/lint 0 错误**

## 实测性能（happy-dom 环境，真浏览器更快）

| 指标 | 数值 |
|---|---|
| 分页 5,000 行（139 页） | **56ms** |
| DOM 渲染 | 28ms/页（全量渲染非热路径，虚拟化后仅渲染窗口内 2-3 页） |
| 视口窗口计算 1000 页 × 100 次 | **1.65ms** |
| example 整包（含 Vue 运行时） | gzip 34KB |

## 已完成能力清单

### core (@agile-team/mach-report)
- [x] RenderPlan schema（对齐 jh4j gridPlan 逆向结构）
- [x] mm↔px↔pt 单位系统 + 纸张尺寸表
- [x] 近似文本测量（CJK/拉丁宽度模型）与折行
- [x] 模板→RenderPlan 分页引擎：跨页/表头重复/行高自适应/列宽缩放/万行稳定
- [x] DOM 渲染器：文本/富文本/预折行/图片类/形状/真实 table 网格
- [x] **视口页级虚拟化**（computePageWindow + 组件接入）
- [x] **性能预算测试**（CI 回归门）
- [x] **RenderPlan 校验器**：error/warning 分级、JSON path 行级定位、坏数据防御
- [x] **jh4j 模板导入转换器**：逆向 schema（GlobalConfig/PageNode/ElementNode）→ ReportTemplate，未知降级+告警不抛错

### sql-engine (@agile-team/mach-report/sql)
- [x] `#{}`/`${}`/`{if(cond,a,b)}` 全语法（手册三范式 + 嵌套 if 回退再编译）
- [x] 表达式求值器：isEmpty/==/!=/+、双引号字符串、`\{` 转义、括号嵌套
- [x] 单 SELECT 结构校验：注释剥离/多语句/DML/DDL/SELECT INTO 拒绝
- [x] 缺参容错（NULL 绑定+告警）；200 动态条件稳定性

### vue (@agile-team/mach-report/vue)
- [x] ReportPreview 契约组件：props/emits/expose 与 jh4j 1:1
- [x] 换单据先清空再渲染（根治闪旧内容）；错误态+重试
- [x] jh4j gridPlan 适配器（request 注入）+ 本地适配器（core 直出）
- [x] 工具栏：翻页/适宽/100%/150%/导出/打印/PDF 窗口；打印 iframe+@page
- [x] 渲染前 schema 校验（行级错误直达 UI）

### federation (@agile-team/mach-report-federation)
- [x] reportPreview/reportHtmlPreview/filePreview 三入口，expose 名对齐
- [x] fetcher 通过 InjectionKey provide/inject 注入（宿主掌控数据面）

### 工程
- [x] pnpm monorepo / TS strict / vitest(106) / Playwright E2E(3) / eslint(0 err)
- [x] 性能预算门 + 逆向文档 + 进度日志

## 夜间未完成 → 后续队列

- [ ] **PDF 前端直出**（pdf-lib + 中文字体子集嵌入；打印 iframe 方案已可用）
- [ ] **designer/manager 包**（画布设计器 MVP：网格布局/文本/列表/条码；管理端列表/发布/导入导出）
- [ ] canvas 渲染后端（当前 DOM 后端 + 虚拟化已达标，canvas 为进阶）
- [ ] jh4j 模板导入覆盖表格 Cells 完整结构（当前已支持文本/表格/线条/形状，富文本降级为纯文本）
- [ ] shadow DOM 样式隔离（宿主集成时验证必要性）
- [ ] 字体测量升级：浏览器 canvas measureText 校准近似模型
- [ ] CI（GitHub Actions：typecheck+lint+test+e2e）

## 关键决策记录

1. **不兼容 jh4j 私有模板格式**（PascalCase 历史结构），自研干净 ReportTemplate + 单向导入器——逆向证实完整兼容成本高且无必要
2. **校验器 error/warning 分级**：未知 kind 是 warning（jh4j 有扩展组件，不能阻断渲染），结构损坏才是 error
3. **性能预算用"率"不用绝对值**（happy-dom 有噪声；28ms/页门防数量级回归）
4. **多列表顺序流分页**（L2 接 L1 末页）——v0.2 语义，独立分页流进 roadmap
5. **嵌套 {if} 用未引用分支回退机制**（jh4j 公式语言无引号转义，嵌套引用无法表达；回退再编译天然支持任意深度）
