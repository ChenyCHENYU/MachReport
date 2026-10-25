# 目录与依赖边界

MachReport保持一个npm发布包，以模板 / 数据 → 统一计划 → 预览和输出为主线。扩展通过子路径、配置和适配器加入；业务接口、数据库模型、权限与发布环境不进入通用内核。

```text
宿主 reports / Provider / 模板存储适配器
        │
        ▼
source/ ── 参数、字段契约校验 ── layout/ ── RenderPlan
        │                                    │
server/ Runtime + budget + queue              ├─ render/ DOM / Canvas
        │                                    ├─ vue/ hooks + 预览外壳
worker/ RPC（浏览器 / Node独立适配）           ├─ pdf/ / xlsx/ 按需输出
                                             └─ output/ 能力诊断 / 资源准备
designer/ ── 模板文档 + 独立预览 + save hook
analytics/ ── 数据变换或基础图元，再进入同一计划
xlsx/node ── AsyncIterable → 逐行工作表（不构造完整计划）
```

| 目录 | 责任与约束 |
| --- | --- |
| `schema/` | 计划、来源身份、字段契约与校验；纯数据，无业务请求 |
| `builder/` | 常规模板工厂与字段契约生成列，集中处理默认值和自然列宽 |
| `layout/` | 毫米排版、字体测量、折行、分组、汇总、多层重复表头 |
| `source/` | 取数编排、参数、Provider协议、模板目录 / CAS Manager；通过注入函数访问外部 |
| `editing/` | 纯单格 / 批量验证、冲突与不可变应用、TSV解析、版本结果；不访问DOM或数据库 |
| `vue/composables/` | `useCellSelection`、`useEditHistory`、`useFrozenPanes`、搜索 / 缩放 / 页窗口等状态与生命周期 |
| `output/` | 按出口诊断能力，受预算和取消控制的资源准备 |
| `render/` | 共享网格几何和样式、DOM与Canvas / PNG；异步图片独立模块 |
| `pdf/`、`xlsx/`、`sql/` | 资源与输出专属依赖，只进入相应构建入口 |
| `server/`、`worker/` | 受控执行、任务队列、消息序列化和响应守护；Node线程入口独立构建 |
| `designer/` | 可选属性组件与`useTemplateEditor`；复用模板验证和现有预览，不复制引擎 |
| `analytics/` | 有预算的数据计算 / 交叉汇总与图元生成，不加载第三方图表框架 |
| `processing/` | 核心与analytics共用的纯计算、十进制、聚合和矩阵；核心不反向加载可选子入口 |

## 接入原则

常规页面只传报表ID和参数；宿主集中注册模板与数据源。只有用到远程编辑、资源渲染、存储、公式引擎或Worker时才提供对应适配器，不要求业务页面维护内部状态机。

编辑以`sourceScope / datasetId / rowKey / field`识别业务格，计划坐标仅用于屏幕定位；默认来源隔离，同源镜像显式声明共享。保存的`requestId / revision / sourceToken`与数据库协议衔接。保存、撤销、重做和恢复共用一个事务路径。冻结仅改变屏幕呈现，不改打印或导出几何。

模板状态与不可变历史分离；常规草稿保存不读取整份历史。存储器的CAS需在同一事务内更新状态并追加发布版本。默认内存实现说明协议，可由文件、HTTP或数据库适配替换。

浏览器和Node声明 / 产物分开生成，避免浏览器ExcelJS替代Node流式实现。十三个代码入口均验证ESM / CJS和类型，CSS与内置编码Worker另作为发布资产校验；隔离消费端刻意不安装ExcelJS / PDF / SQL / 码图源依赖，检查公开包是否可独立使用。Worker资产另经Vite实际生产构建，不能仅核对文件存在。

固定标签由核心的逐记录生成器展开，静态字段绑定只读取自有标量数据，按记录、份数和模板页顺序生成；完整页预算在分配前检查。码制配置是可序列化数据，实际编码和 PNG 生成仅位于可选 `/codes`，复用 `output/assets`。设计器和 Node Runtime 使用同一适配器，核心及默认 Vue 构建不依赖编码库。第三方版权声明随发布包保留。

## 性能与质量门禁

所有生产TS / Vue函数圈复杂度≤20，无文件豁免。通过按职责提取函数与hooks降低耦合；类型、lint、打包、覆盖率、真实浏览器和隔离包消费都属于验证范围。

预览按可见页窗口挂载，搜索分片取消；批量编辑一次构建局部几何解析器，并按组件 / 行应用不可变复制。PNG逐页绘制 / 编码，资源与图片有预算；Node全量数据导出可用逐行出口。有界队列限制并发，Worker可终止同步计算。

`usePageWindow` 计算几何范围，`usePageRendering` 管优先页、逐帧挂载、占位和代际取消；选区按新挂载的holder初始化，已有节点仅更新变化状态。几何、DOM构造和交互分别维护，避免把大宽表缩放调度交给集成页面。

`paginateTemplatePages`是真正逐页生成器，`paginateTemplate`在同一内核上收集完整计划。双遍页数计数复用计算 / 矩阵准备结果，输入数据与分组 / 关联索引仍按预算保留。Runtime在分页前预检逻辑规模，逐页累计实际渲染格（含重复锚点与嵌套网格），最后核对总量；多报表共用额度。Node全量Excel可另走AsyncIterable出口。[质量矩阵](./QUALITY.md)记录各输出能力差异。

设计器按 `useTemplateEditor`（文档事务）、`useTemplateCanvas/useCanvasPointer`（几何交互）、`useRuleEditor/useRuleDataLayout`（声明式规则）、`useExcelBindingWizard`（工作簿会话）、`useTemplateWorkspace`（工具导航）拆分。大JSON历史保存可逆增量与周期检查点，拖动在RAF局部预览后一次提交，不把频繁交互变成全模板重排。

`source/template-diff/template-review`处理纯变更和样例预检；`server/publication`才按需编码真实文件。`server/job-service`通过注入的原子CAS存储处理租约、attempt围栏、进度和恢复；`node-job-store`是独立单进程文件适配器，集群数据库由宿主提供。

`source/template-outline/template-fragments` 提供纯结构索引、字段引用与独立片段操作；设计器的面板和 hooks 只处理选择、重绑、显式升级及验收视图。`useTemplateDraftRecovery/useTemplateConflict` 管暂存与共同基线，`useTemplateToolDrafts` 收集声明，不引入业务数据持久化。慢存储按适配器与键合并为一个在途操作和一个最新操作。

`server/runtime-output` 共用编码路径，`prepared` 处理有界快照与字体身份；`exportPrepared` 不经过取数或分页。`layout/label-sheets` 处理纯毫米拼版，`server/label-stream` 处理异步来源、分块与回执背压。两者复用既有计划和预算。`vue/print-resources` 只准备打印文档资源，`print-calibration` 只生成测试纸张，不能修改业务模板或宣称设备已打印完成。

## 操作生命周期与公开声明

`usePreviewConfiguration` 集中处理配置层级与工具能力交集；`usePreviewFont` 管理字体检查/缓存；`preview-plan` 负责查询与导入计划准备。`useDiscardGuard`、`usePreviewTask`、`usePreviewDiagnostics` 各自管理替换决定、任务与诊断，组件只做生命周期接线。观察者不能改变事务结果，代际与小型身份快照阻止旧确认、旧输出、旧诊断污染新报表。

| 稳定边界 | 持有状态与依赖方向 |
| --- | --- |
| `usePreviewSession` | 查询/导入的参数快照、代际、取消、错误、已查询上下文；只通过明确view/events回调提交结果 |
| `usePreviewEditing` | 编辑事务、选区、草稿与离开保护；来源身份由核心editing维护 |
| `usePreviewOutput` | 保真策略、任务通知和物理打印配置；调用编码/下载，不自行取数 |
| `usePreviewEncoding` | 默认PDF字体准备与已显示计划的编码适配，保留自定义导出器/Excel函数选项兼容 |
| `useReportExportExecution` | 首次导出按需加载执行器、等待期间快照/取消、实例释放与旧决策隔离 |
| `useDesignerNavigation` | 目标/工具/未应用配置的切换及异步确认代际；文档修改仍走useTemplateEditor事务 |

`worker/auto-policy` 只做有界估算；`auto-core` 管并发、快照、取消与回退；browser/Node适配器负责原生实例。`render/rich-text-layout` 只产出排版结果，Canvas和PDF各自绘制；`schema/component-tree` 在递归前限制节点/深度及循环，不扫描无关元数据或媒体字符。边界按状态所有权拆分，不给每个业务页面暴露内部状态机。

`editing/fields` 的字段约束由单格、批量、历史与Node共用；`vue/cell-editor` 仅负责单实例控件和焦点。设计器使用独立列操作、受预算历史与丢弃保护hooks，复用同一模板文档/CAS协议。

公开SFC声明通过TypeScript AST投影到最低受支持Vue与当前Vue的共同公共契约，保留props/events/controller/slots；不输出编译器私有provider/template-ref状态。遇到未知声明形态会阻止构建，严格ESM/CJS消费端同时验证正确与错误调用，避免通过any或skipLibCheck掩盖兼容问题。

## 产品能力的扩展边界

宽表预览在既有页窗口内使用独立DOM视口控制器。几何和边线索引只属于挂载页，滚动复用可见节点；合并锚点即使起点在视口外也会保留。显式字段/键盘定位先滚动并补齐目标格，当前挂载页的活动编辑格在页内滚动时保留。完整RenderPlan和静态输出不裁剪；搜索或冻结模式回到完整页，不改变匹配序号或打印几何。默认小报表沿用简单渲染路径，无新增业务配置。

编辑会话的计算workspace只存在于包拥有的快照及其候选副本。行依赖检查、候选结果缓存和事务提交分离，不缓存外部可变数据或跨租户业务值；分组/整表/字符串公式的保守回退保证口径。分页仍使用同一完整内核，单次迭代的文本测量缓存有界，避免将增量计算误称为完整增量分页。

层级矩阵复用现有合并表头、GridRow、表片段和出口，不另建渲染协议。复杂单据通过独立flow区域组合，单一数据区域仍拒绝含糊的树/矩阵/主从混合。组件扩展先通过受控资源适配生成现有标准组件；模板不携带加载器、脚本或凭据。按页文档和OpenAPI属于可选server入口，不进入普通预览接入。
