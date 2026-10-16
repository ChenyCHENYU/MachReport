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

## 接入原则

常规页面只传报表ID和参数；宿主集中注册模板与数据源。只有用到远程编辑、资源渲染、存储、公式引擎或Worker时才提供对应适配器，不要求业务页面维护内部状态机。

编辑以`datasetId / rowKey / field`识别业务格，计划坐标仅用于屏幕定位；保存的`requestId / revision / sourceToken`与数据库协议衔接。保存、撤销、重做和恢复共用一个事务路径。冻结仅改变屏幕呈现，不改打印或导出几何。

模板状态与不可变历史分离；常规草稿保存不读取整份历史。存储器的CAS需在同一事务内更新状态并追加发布版本。默认内存实现说明协议，可由文件、HTTP或数据库适配替换。

浏览器和Node声明 / 产物分开生成，避免浏览器ExcelJS替代Node流式实现。十二个代码入口均验证ESM / CJS和类型；隔离消费端刻意不安装ExcelJS / PDF / SQL源依赖，检查公开包是否可独立使用。

## 性能与质量门禁

所有生产TS / Vue函数圈复杂度≤20，无文件豁免。通过按职责提取函数与hooks降低耦合；类型、lint、打包、覆盖率、真实浏览器和隔离包消费都属于验证范围。

预览按可见页窗口挂载，搜索分片取消；批量编辑一次构建局部几何解析器，并按组件 / 行应用不可变复制。PNG逐页绘制 / 编码，资源与图片有预算；Node全量数据导出可用逐行出口。有界队列限制并发，Worker可终止同步计算。

完整模板分页仍构造完整计划，不能从窗口化推导任意数据量恒定内存。默认Runtime在分页前预检逻辑规模，分页后核对实际页 / 单元格数；大任务选择Worker或流式出口，并在业务API限制查询范围。[质量矩阵](./QUALITY.md)记录各输出能力差异。
