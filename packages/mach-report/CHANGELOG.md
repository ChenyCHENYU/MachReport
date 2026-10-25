# @agile-team/mach-report

## 2.17.0

### Minor Changes

- 增强层级矩阵与复杂区域组合、私有编辑会话增量计算、宽表行列视口渲染、受控组件注册与设计器插入；完善共享指标语义、模板迁移、按页文档存储、OpenAPI/Java客户端和API兼容审阅。保持常规接入简洁，既有模板和输出入口兼容，补充真实输出与浏览器回归。

## 2.16.0

### Minor Changes

- 完成复杂内容输出、自动隔离编码及预览/设计器职责收敛，补齐持续验证和外部验收交接。

  - Canvas/PDF支持格内递归内容与裁切，共享基础富文本布局、混合字面和下划线；Excel保留原生富文本与图片锚点，混合字体导入保持只读。不可表达项继续具名诊断。
  - 增加有界自动执行策略、包内浏览器编码Worker与Node自动线程入口，支持压缩期硬取消、超时、并发上限、输入快照和旧结果隔离；保持自定义导出器兼容。
  - 拆分查询/导入会话、编辑事务、输出策略和设计器导航职责，修复异步目标切换与卸载清理，按需加载隔离执行器。
  - 加入fast-check属性测试、每日/手动深层CI和真实浏览器axe门禁，修复异常几何错误格式化及可访问性问题；补充代表样例、人工验收结果表和下一轮计划。

## 2.15.0

### Minor Changes

- 完善数据隔离、设计交互和前后端共用流程，保持基础预览接入简洁。

  - 独立报表默认隔离编辑身份、来源修订与撤销历史，同源镜像显式共享；用有界结构核对替代大字段逐字符指纹扫描。
  - 严格 PDF 在编码后检查缺字和实际降级，图片统一限制字节、数量与解码像素；观察回调失败不反转已完成的保存或写入。
  - 连续 Excel 按工作量分片让出；补齐索引色、PNG/JPEG 模板图片导入和支持范围内的富文本输出。
  - 增加远程级联参数、携带返回上下文的受控关联详情、可选模板发布/批次工作流和可搬运模板包。
  - 设计工具保留目标与画布，改进输入法、超宽字段目录和全选；仅修改名称等元信息时不重新分页。
  - Runtime 立即快照请求并保留有序来源，任务上下文提供执行代次；矩阵共享维度计算并按需汇总。
  - 增加公开 API 快照、覆盖率下限、依赖清单与发布产物摘要门禁，更新 README、接入示例、能力边界和升级说明。

## 2.14.0

### Minor Changes

- 完善设计、验收与交付流程，保持新增能力按需接入。

  - 支持同一准备结果和已保存实例的 PDF/XLSX 导出，保留数据修订与字体度量身份；Worker 共用新协议，不重复取数或分页。
  - 打印等待独立文档的字体和图片准备，设置提供毫米校准和同规格测试页；资源并发、超时及取消均有界。
  - 设计器支持可选草稿恢复、未应用配置暂存与 CAS 冲突核对，保留副本及显式更新基线。
  - 增加跨页结构大纲、字段引用影响、片段重绑与显式升级、内容样式、命名验收样例及基线并排对照。
  - 多样例验收按阶段让出主线程，提供进度与取消；保留同步 API，输入改变后隔离旧结果。
  - 业务诊断可声明来源缺失、不适用和无法计算，紧凑展示并按稳定业务身份定位；真实零值保持不变。
  - 支持原尺寸标签整纸拼版及 AsyncIterable 分块交付，以归档回执控制背压，限制来源、主键索引、快照和输出预算。
  - 更新示例、接入与架构文档；补充真实浏览器、隔离打包消费和边界回归。

## 2.13.0

### Minor Changes

- 精简标签集成、优化设计与预览交互，并降低批量排版重复计算。

  - 新增 defineLabelReport，模板与行数组或取数回调直接接入，自动映射单数据集及字段契约，复用前后端来源管线。
  - 标签预览显示当前记录、业务键和版面，提供相邻记录导航；无列内容时隐藏空的字段目录。
  - 修复短页面在末尾因滚动位置受限导致明确选择的页码回退，缩放、换报表和用户滚动仍按实时几何更新。
  - 设计器内容优先，位置尺寸及编码高级项按需展开，目录显示页面名称和业务字段；撤销重做恢复正确的页与组件。
  - 标签折行使用请求内双重有界缓存，保留逐记录溢出、取消与预算检查。
  - 更新标签工作台示例、窄屏数据切换与 README / 接入 / API 文档。

## 2.12.0

### Minor Changes

- 工业标签设计与输出：固定毫米纸张、逐记录字段绑定、多版相邻与受控份数；新增可选 codes 入口，统一生成经过真实解码验证的 QR、Code128、Code39、EAN13/8 PNG，支持浏览器及 Node，静区、像素与缓存有界。设计器新增纸张、版面、数据绑定、码图属性及毫米标尺，复用撤销、只读与 CAS。Runtime 支持本地资源适配，示例、文档、消费端和真实输出验证同步。
- 修复完整字体在 PDF 中使用替代字形后缺失字宽与文本映射的问题，避免数字异常拉开、右对齐内容越界；保持完整字体和原始文本，不增加逐字符绘制或重复字形排版。

## 2.11.2

### Patch Changes

- PDF 字体加载支持完整字体的 gzip 静态资源，减少中文字体首次下载体积，保持解压后的原始字形与嵌入保真。压缩传输与解压结果均遵循字节预算、超时和取消约束；自动 HTTP 解压不重复处理，不支持解压的环境给出明确诊断。

## 2.11.1

### Patch Changes

- 完善设计器操作闭环：模板库区分草稿编辑与发布版查看，按原搜索/打开/复制操作重试；参数与 Excel 绑定提供就地错误、首错和区域/字段定位，待应用配置跨分区可返回；日期区间使用双日期控件并保持字符串契约。批量取消后继续待处理任务，保留成功回执，支持状态筛选及下一失败定位。修复产品参考示例的草稿修订冲突、发布前保存检查、实例幂等与批次状态丢失，并改善长文本和窄屏布局。

## 2.11.0

### Minor Changes

- 完善可复用的报表产品工作流，保持常规预览入口轻量和框架无关内核：

  - 增加可视化查询参数设计，月份、年份、日期区间与前后端共用校验/Schema；未应用参数参与草稿保护和撤销重做。
  - 增加兼容旧配方的 Excel 多区域绑定：同 Sheet 单记录/纵向明细数据集、静态邻格、显式流式排版、跨页页尾与真实 Excel 几何回读；区域布局由绑定向导管理，阻止不安全的画布结构变更。
  - 增加 flat/nested 树形报表，稳定来源身份、精确叶子汇总、防双算总计、有界预检和跨 DOM/Canvas/PDF/XLSX 缩进；嵌套数据首版保持只读。
  - 增加可分页模板库和真实复制存储动作、批量参数预检/有界并发/逐行状态/显式重试面板、框架无关批量执行 API。
  - 增加明确区分预览与生成的实例快照、不可变修订/CAS 存储契约和有界内存参考适配器；安全校验拒绝访问器、非规范数组、非法标识与未知实例字段。
  - 补齐综合产品示例、实际中文 PDF 下载与 Excel 回读验收；记录连接管理、企业身份权限、调度和渠道的后续边界，未实现这些平台服务。

## 2.10.0

### Minor Changes

- 完善复杂报表正确性、设计器与资源治理，保持普通页面接入方式不变。

  - 稳定业务键的数据源自动管理编辑重算会话，保存前准备计算、成功后发布；公式派生列只读，撤销和定位跟随业务身份，导出等待在途编辑。
  - 修复首列数值汇总被标签覆盖、忽略的孤立明细误触发校验、主从并发字段继承及验收样例参数校验。
  - Excel 导入逐块取消预检，新增有界工作簿会话供元数据、Sheet 选择和转换复用；普通 XLSX 支持有预算的 PNG/JPEG 图片及图片式二维码。
  - 设计器新增真实样例样式、规则说明与草稿保护、多选对齐分布、视口适配和会话内位置锁；验收结果随输入变化失效。
  - 持久任务预留控制状态空间，提供终态清理和幂等摘要；字体采用有界缓存与单资源下载预算。
  - 补充回归、兼容验证及文档，并在启动浏览器前检查 macOS seatbelt 限制。

## 2.9.1

### Patch Changes

- 修复旧门户浏览器缺少structuredClone时画布复制不可用：采用已验证JSON模板的独立快照复制，保留组件身份清理和几何约束。新增缺失原生API与设计器实际产物回归，不降低消费项目兼容门禁。

- 修复规则编辑器的数值模式默认项：公式、分组聚合与矩阵度量省略配置时明确显示“普通数值”，保留显式精确十进制选项，打开面板不改写宿主模板。

## 2.9.0

### Minor Changes

- 完善可选可视设计器：毫米画布、拖动缩放吸附、组件层级、列顺序/显隐/宽度与安全合并表头；通过独立 hooks 和单事务拖动减少高频全模板更新，编辑历史使用可逆增量与周期检查点。

  增加 Excel 业务绑定向导与可重开会话，按区域和字段契约生成数据驱动模板；集成替换保留模板身份和CAS修订。增加声明式计算与规则配置、多级分组/加权汇总、业务键主从明细、动态矩阵和重复页眉页脚，精确十进制计算由前后端共用处理层执行。

  增加模板语义变更对比、字段依赖与显式样例预检、发布前真实PDF/XLSX验收及beforePublish门禁。提供真正逐页排版、全局实际渲染格预算与可恢复任务服务：原子CAS、租约/attempt围栏、取消、最新进度合并与显式重试；Node文件适配器使用单进程写锁和原子持久化。

  补充单测、真实浏览器、输出回读、隔离包消费及文档，保持常规预览接入兼容与核心零运行时依赖。

## 2.8.4

### Patch Changes

- 重设计模板属性工作台：常用属性集中首屏，字段目录按需打开，结构化内容与格式分组、紧凑对齐控件和模板技术信息折叠，保留字段导航、批量操作与草稿保护。

## 2.8.3

### Patch Changes

- 修复模板工作台在较矮容器中切换分区继承属性面板滚动位置的问题；模板及高级分区从标题开始展示，返回字段仍露出当前活动列，并保持焦点和外层页面位置。

## 2.8.2

### Patch Changes

- 重整模板工作台为字段、模板与高级三个分区，以紧凑可搜索的字段目录和单列属性替代逐列展开表单；保留实时预览、批量对齐、撤销重做、保存及 JSON 草稿保护，提供键盘导航及可选保存状态供宿主锁定跨模板动作。

## 2.8.1

### Patch Changes

- 修复宿主表单样式导致的分页错位：在包内隔离表单与控件的外边距、尺寸和文字基线，统一页码、翻页按钮、跳页输入及选区计算入口的垂直中心线与右侧间距，使用方无需额外覆盖样式。

## 2.8.0

### Minor Changes

- 打磨预览默认工作台：分页移至右下方，工具分组与导出菜单、搜索和字段目录统一键盘交互；设置改为常规、工具与高级分区，浅色主题与淡蓝空态支持主题覆写。增加默认关闭的只读选区计算，提供摘要函数及受控组合公式、预算、取消和结果隔离，不写回业务值或执行 Excel 原公式。

## 2.7.0

### Minor Changes

- 完善复杂报表的产品操作闭环：默认本地修改保护、阶段进度与取消、严格输出诊断及定位、字段类型编辑器、中文列目录、设计器批量操作与历史。补齐Java→Node参考服务、真实混合并发与复杂PDF/XLSX回读验收、跨浏览器门禁及八组合Node/Vue严格消费。按职责拆分预览与设计器生命周期，保持常规页面接入不变；校正最低Vue补丁版为3.2.47，并以AST维护兼容的公开组件声明。

- 优化大宽表适宽时的按帧挂载与定位优先级，取消过期渲染；缓存选区地址与绘制状态，重复刷新不再写入相同属性，保留表头语义和键盘操作。

## 2.6.1

### Patch Changes

- 细化真实报表工作流并修复遗漏，继续保持接入侧精简：

  - 查询参数提取独立hook，所有查询入口共用类型/范围/日期/长度校验；首次缺少必填值显示中性引导，提交后提供字段错误、焦点和无障碍关联，允许清空可选条件并避免默认值意外补回。
  - 修复键盘Tab边界、多层表头与业务行坐标、跨页选区和重复表头；完善搜索快捷键/IME/聚焦、具名缩略图按钮及设置前异步编辑提交。
  - 修复导入Excel无边框、单边框和空白数字格对齐；DOM/Canvas/PDF共享边线解析，设计器对齐选项与实际默认值一致。
  - 异常参数定义和保存响应返回结构化错误；保存结果不明确时提示重新查询确认服务端状态。
  - 分页期间执行可选maxPages预算，多报表共享剩余额度，避免生成完整计划后才检查超限。

  原始PlanFetcher配置paramDefs时也会在查询前校验；首载缺少必填参数不再发请求。请给需要自动首载的必填字段提供params或defaultValue。

## 2.6.0

### Minor Changes

- 完善报表工作流与前后端复用，保持常规页面仅传报表ID和参数：

  - 增加字段/参数校验和JSON Schema、统一Provider与显式保存桥接、稳定业务主键及修订身份。
  - 增加区域选择、复制/原子粘贴、保存型撤销重做/恢复、变更清单、冻结窗格、导航与可选偏好存储。
  - 增加Excel业务区域绑定、多层重复合并表头、模板CAS管理与独立轻量属性编辑器。
  - 增加Node Runtime、预算、有界任务队列、真实浏览器/Node Worker和Node逐行流式Excel出口。
  - 增加独立交叉汇总、声明式计算、基础柱图/折线图与可选资源渲染适配。
  - 统一字体测量/字距/粗斜体、真实斜线、异步Canvas图片及逐页PNG编码；提供输出能力诊断。
  - 扩充单测、真实浏览器/Worker与隔离安装包验证，保持核心无框架重依赖及复杂度≤20。

  必填参数现于取数前校验；现有未传必填参数的调用需补齐值或默认值。导入Excel公式仍不重算，模板/编辑数据库持久化和权限仍由宿主适配器处理。

## 2.5.0

### Minor Changes

- 预览新增默认可见设置入口，统一管理阅读、导出、打印及可选编辑/导入工具；保留宿主能力上限，支持精简配置和宿主设置插槽。新增显式零数据 SVG 反馈，完整宽表仍可保留表头且空态保持在可见视口内；设置关闭编辑前校验提交，原生导出保留当前计划的修改。

## 2.4.1

### Patch Changes

- Preserve number formats on empty and text cells during typed Excel export, including imported blank numeric templates and numeric cells cleared by editing. Add real workbook roundtrip coverage for empty and cleared values.

  Clone Vue report snapshots through their JSON DTO contract, accepting reactive proxy inputs and avoiding a dependency on the browser structured clone API in preview, editing and import paths.

## 2.4.0

### Minor Changes

- Add optional double-click cell editing with typed values, immutable report updates, validation and asynchronous host save callbacks. Editing defaults to off and all outputs share the committed report snapshot.

  Add lazy Excel template import with multiple worksheets, merge-safe wide-table segments, A3/A4 options, common cell styles and number formats, bounded resource validation and explicit unsupported-feature warnings. Imported templates are reusable JSON and never execute formulas or call business APIs.

  Keep Excel column widths and numeric formatting consistent across import, edit and export; document the minimal Vue and framework-independent APIs and extend real Chromium coverage.

## 2.3.2

### Patch Changes

- 修复部分中文 TTF/OTF 字体在 PDF 子集嵌入后出现字形不可见的问题。自定义字体改为完整嵌入提供的字体文件，保留原始字形映射，并修正 OTF 的 PDF 字体类型和 OpenType 流声明；原有字符覆盖检查继续生效。补充真实中文字体与输出字形回归，说明完整嵌入对 PDF 体积的影响。

## 2.3.1

### Patch Changes

- 修复宿主CSS撑破报表几何、跨后端字体单位/内距/行高继承、页码锚点和多行组头防孤行；完善PDF保真诊断与Excel合并行高，修复卸载句柄和旧打印任务取消、自定义纸张精度、搜索与实际DOM一致性。

  按职责拆分模板、分页、渲染、导出、数据源与模板校验热点，新增全部生产函数圈复杂度≤20硬门禁；单测和浏览器验证统一零重试，补齐质量、样式隔离及输出能力文档。

## 2.3.0

### Minor Changes

- 新增完整自然列宽模式 `layout: "wide"`：列宽不受标准纸型约束，默认 100% 预览、水平滚动、紧凑纵向分段和窗口化缩略图；搜索可定位远右列。默认纸张模式保持兼容，A3/A4 标准模板与 Excel 打印纸型可独立选配。

  列表计划保留稳定表身份、逻辑行序与列结构。Excel 默认将宽表还原为连续工作表，精确去除重复表头，保留全部列、原始数值、分组及汇总，并冻结标题表头；多报表隔离，无法可靠合并的自由布局回退并告警，显式连续模式拒绝不明来源。

  增加 Excel 真实规格保护：超长单元格明确拒绝，超宽列及超高行保留值并适配显示尺寸、返回告警，避免无提示生成不兼容文件。

  修复白底正文继承浅色宿主文字及容器变窄后搜索结果遮挡；维持分片时间预算并减少大宽表搜索的定时器等待。

## 2.2.0

### Minor Changes

- 增强报表配置、模板管理基础和大数据预览体验，保持应用一次注册、页面只传报表 ID 与参数。

  - 标准明细默认表头居中、内容按类型对齐，支持独立表头与列样式；大字号表头参与行高测量。
  - 新增版本化 JSON 模板文档、校验、导入导出、模板目录与异步模板加载；保留旧静态模板兼容，修复异步多报表的参数快照。
  - 正文缓存页索引、缩略图窗口化并释放画布；搜索分片、取消并压缩命中记录，新增可继承的 preview 配置。
  - Excel 可选保留原始数值、布尔、文本编号、空值及汇总格式；自动识别 A3/A4/A5，修复样式继承、字号和无边框一致性。
  - 补充真实工作簿回读、DOM/Canvas 对齐、1000页 Chromium 预览、动态模板及隔离 npm 消费回归；更新 README 和模板管理、API、Excel 文档。

## 2.1.0

### Minor Changes

- 5697af6: 新增框架无关 createReportSource 与类型化 defineReport，支持插件 reports 一次注册模板和业务取数，包内完成分页、校验、告警和有序多报表合并，自动读取模板参数。Vue 入口重导出核心 API，并新增 useMachReport 父页面控制句柄。完善请求取消与完整响应超时、配置字段继承、异步注册开关，以及可等待的导出、并发去重和卸载清理；保留旧 fetcher、本地适配器及组件控制入口。
- 新增只读预览和导出状态、可重试的轻量 PDF 字体预检查，以及按纸张和边距自动分配列宽的 createTableTemplate 标准明细模板。完善字体加载诊断、真实自定义字体缺字检测、打印与 PDF 窗口忙碌状态，保持旧控制器、导出函数和毫米模板接口兼容。

### Patch Changes

- aec9234: 修复报表网格列宽、字号、合计列传递和纸张 DSL 选项，以及 XLSX 合并范围、标题列数、降级告警与完整类型声明。补强渲染计划校验、Vue 请求生命周期、SQL 执行注释检查、构建产物和独立消费端校验。统一 MachReport 品牌 README，明确 Excel 能力边界，补齐中文 PDF 示例字体并更新安全依赖补丁。

## 2.0.0

### Major Changes

- MachReport now uses a project-neutral report contract. `ReportPreview` accepts `reportId`, and `PlanFetcher` receives `{ reportIds, params }`. Applications must provide a fetcher or use `createLocalFetcher`; the plugin no longer calls a built-in report service. Removed the old service adapter, response wrapper, template importer, and manager API. Updated the federation wrappers, examples, README, and API guide to use the independent integration model.

## 1.2.2

### Patch Changes

- ae4109c: 重写 README 的接入说明与文档导航，并将首页横幅改为清晰的方形 SVG 图标。

## 1.2.1

### Patch Changes

- 0e0d982: 修复真实 gridPlan 契约测试在样本存在时的 DOM 环境问题，支持逐张采集和验证多份脱敏样本，并明确真实模板验收边界。

## 1.2.0

### Minor Changes

- 67101f0: 修复 jh4j 网关接入和参数同步，接通 Excel 导出与真实 PDF 窗口，增加中文 PDF 保真告警和逐页打印，并补齐契约采集与验收文档。

## 1.1.2

### Patch Changes

- e43c502: 对外 README 净化与信息安全修复：

  - 移除“文档”章节（内部迭代日志/逆向结论/协作指南不对外暴露）
  - 逆向文档中的内网 SIT 地址脱敏（改为文字描述）
  - 抓取脚本内网地址改为 MR_SIT_BASE 环境变量注入并加缺失守卫

## 1.1.1

### Patch Changes

- 8a1d2b8: README 质感收敛（克制排版）：

  - 标题与折叠摘要移除 emoji 装饰符，回归纯排版层级；导航锚点同步
  - 移除正文手写版本号/迭代轮次（npm 徽章动态显示，避免过期）
  - 新增 prepublishOnly 自动同步根 README 进包——npm 包页与 GitHub 呈现一致

## 1.1.0

### Minor Changes

- 01eb85b: 出口矩阵补齐 + Node 无头导出通道（对齐并反超 jh4j 出口能力）：

  - 图片导出：引擎 renderPlanToImages（png/jpeg、区间/dpr/质量、SSR 守卫）+ 工具栏"导出图片"（多页连续下载、并发去重）
  - Word 导出：buildWordHtml（Word 兼容 HTML + office 命名空间 + Print 视图、named pages 尺寸保持）+ 工具栏"导出 Word"，可编辑 .doc 零后端
  - Node 无头通道：font-loader 双环境（无 IndexedDB 降级内存缓存）；renderPlanToPdf/Xlsx 在 Node 18+ 可跑——定时任务/邮件推送/归档用同一引擎，服务端零渲染代码
  - 新增 export 错误码（图片/Word 导出失败分类）

## 1.0.1

### Patch Changes

- README 质感重制（对齐 mach-table 家族版式）：

  - 新增 assets/mach-report-logo.svg 徽标（文档表格图形 + 家族字标 + 管线三出口）
  - README 重构：居中 logo + npm/CI/零依赖/node/license 五徽章 + 浓缩定位；快速开始三段式；核心能力六域矩阵；九大深度区折叠展开（首屏一目了然）
  - 新增路线图区块（v1.0 交付清单 / 设计器与控制台独立立项 / 远期项）

## 1.0.0

### Minor Changes

- a583219: 定版终审（1.0.0 前最后一轮收尾）：

  - 编程式设参：controller/expose 新增 setParams(values, { reload? })，宿主按钮直查场景免面板操作，面板同步显示
  - 文档对齐：README 移除过期计数、本地模式参数面板指引（:param-defs="template.params"）、特性表补参数面板；AGENTS 未了项刷新

## 0.10.0

### Minor Changes

- fa248f5: 参数面板：声明式查询条件，使用侧零表单代码（P3 项补齐）：

  - ReportParamDef 模板自描述参数（text/number/date/select、必填/默认值/选项/占位）；builder .params() 链式声明
  - ReportParamPanel 自动渲染查询面板：查询/重置/回车、必填红框（查询触发后才提示）、主题与文案全可配
  - ReportPreview 集成：paramDefs prop > 模板 params；面板值与 props.params 合并后重载；show-params 走配置中心
  - 根源修复：面板本地字典为唯一真相（连续填写多参数不丢值——props 快照合成会被并发事件覆盖）
  - 必填缺失拦截查询并报 param 错误码；示例与 E2E 演示完整查询流

## 0.9.1

### Patch Changes

- c1e3a9b: 复扫修复：搜索词变更旧高亮残留 + 套件抗抖治理：

  - 高亮先清后套：查询从"钢"收窄到"钢板"不再嵌套两套 mark（仅清空才清除的缺陷修复，含回归测试）
  - 卸载时清理防抖计时器
  - 文档：README 补 logger 通道与格式化语义（digits 精确保留 / thousands 缺省 false / 本地日历日解析）
  - vitest retry:1（负载敏感用例在并行重载下重试一次，阈值不放水）；异步挂载 waitFor 明确 5s 超时

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
