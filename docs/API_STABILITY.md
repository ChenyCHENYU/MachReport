# API 稳定性与模板兼容

MachReport 保持单一 npm 发布物，按运行环境与可选能力拆入口。常规接入不需要遍历所有底层导出，也不需要引入设计器、SQL解析器或完整导出依赖。

| 层次 | 建议入口与职责 | 接入原则 |
| --- | --- | --- |
| 常规预览 | 核心 `createProviderReport`、`createReportSource`、`createTableTemplate`；Vue `reports`/`ReportPreview` | 宿主给模板、字段和 Provider；包内做校验、分页、编辑事务与交互 |
| 后端共用 | `/server` Runtime、Workflow、`createReportOpenApi` | 同一模板/字段/参数；HTTP路由、授权和业务事务留给宿主 |
| 可选产品界面 | `/designer` 模板设计/绑定/发布验收 | 按需加载；不成为所有预览项目的依赖 |
| 输出与分析 | `/pdf`、`/xlsx`、`/codes`、`/analytics`、`/sql` | 仅使用对应能力时加载；SQL解析不等于安全执行SQL |
| 执行与存储适配 | `/worker`、`/server/node`、`/xlsx/node`，各种 Store 接口 | Node专用代码不进入浏览器；参考内存/文件适配器不代表分布式事务实现 |
| 底层扩展 | RenderPlan、几何/格式、组件与诊断契约 | 高级应用显式选择；普通集成沿用门面，避免每项目复制引擎逻辑 |

现有公开导出保持兼容，不为精简表面删除旧入口，也不新增意义相同的别名。新增可选能力应落在已有职责域，通过场景文档引导常规路径。所有公开 TypeScript 类型与运行时函数都受签名门禁保护，底层导出同样不能无提示破坏。

## 发布前实际校验

`pnpm check:api` 从实际构建的十三代码入口提取完整声明签名，核对 `scripts/public-api.json`；两个静态资源入口也在同一基线中。新增、删除、签名或资源路径变化都会使门禁失败，不因变更看似可选而自动放行。

出现变化时，工具打印分类回执：`addedExports`、`removedExports`、`changedSignatures`、`addedAssets`、`removedAssets`、`changedAssets`。删除导出/资源属于明确破坏；签名改变（包括新增必需参数、收窄联合类型、字段或重载变化）一律进入人工差异审阅，而不是用脆弱的文本启发式声称兼容。

审查声明差异、补旧调用方式的运行/类型测试并确认版本策略后，才运行 `pnpm check:api --update`。更新基线也会打印差异回执，不能把“更新成功”当作已证明兼容。消费门禁继续使用真实 tarball，分别验证 ESM/CJS、Vue和Node运行/严格类型，不以源码直接 import 替代发布物验证。

## 模板文档与实例

模板 `schemaVersion` 与 npm 版本、模板业务 revision、数据查询 revision 分开管理。模板格式变化通过显式、可测试的迁移链升级；未知未来版本拒绝加载，不把版本号直接覆盖后继续执行。迁移链的路径与旧 `migrate` 回调兼容方式见[模板管理](TEMPLATE_MANAGEMENT.md)。

模板迁移不改写原历史，不替代数据库 CAS、发布样例验收和授权。实例保存已确认的 RenderPlan、字体身份与数据来源修订；重新导出已有实例不自动升级模板或重新查询数据。旧实例遇到缺少字体度量身份等情况继续走已有明确诊断和严格模式。

本轮有迁移链、旧保存回调、读/发布/回滚与非法迁移回归测试，以及公开签名分类器测试。Office、实机打印和扫码尚无环境时，必须保留未验收状态，不能因 API 或文件结构门禁通过而宣称所有终端还原一致。
