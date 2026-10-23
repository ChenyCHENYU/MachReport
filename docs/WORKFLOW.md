# 模板到实例的接入

`@agile-team/mach-report/server` 的 `createReportWorkflow()` 收拢模板库、草稿发布、发布版批次和实例幂等连接。它在浏览器与 Node 共用；不会加载 Vue、HTTP 框架或 Node 文件系统。

```ts
import { createReportWorkflow } from "@agile-team/mach-report/server";

const workflow = createReportWorkflow({
  templates: templateManager,
  instances: instanceStore,
  scope: accountProjectScope,
  data: { provider: businessProvider, dataSchema },
  // 持久化宿主提供稳定、安全的意图 ID；同一模板与参数组重试使用同一个 ID。
  instanceId: (templateId, caseId) => intentIds.forCase(templateId, caseId),
});

// TemplateLibrary 直接绑定 workflow.catalog。
const batch = await workflow.batch(templateId, {
  expectedRevision: displayedPublishedRevision,
});
// BatchPanel 直接绑定 batch.execute；不会因后来发布新版而改变此批次。
const receipt = await batch.execute({ id: "october", params: { month: "2026-10" } }, { signal });
```

`batch()` 从模板管理器读取真正的发布文档，草稿不能冒充发布版。`expectedRevision` 不匹配时要求重新打开。生成始终绑定该发布快照；重复意图只复用同参数、同发布修订的已提交实例，参数或模板修订改变时返回冲突。并发的相同意图通过实例 CAS 收敛。取数仍由宿主 Provider 负责；`data(document)` 可以为不同模板选择 Provider 或数据契约。

未传 `instanceId` 时使用有界的会话内映射：每个 workflow 实例有独立命名空间，最多 1000 个意图，适合本地体验。跨进程、刷新后的幂等恢复应传宿主稳定 ID，或接入[持久任务](./PRODUCT_PLATFORM.md)。`scope`、数据访问与存储权限由宿主真实身份决定。

```ts
await workflow.publish({
  editor: editorRef.value,
  document: () => currentDocument.value,
  successfulSaves: () => savedCount,
  afterSave: nextTick,
});
```

发布桥只依赖结构化编辑器状态，包内不导入 Vue。干净且已保存的草稿可直接发布；有待应用工具、失败或被吞掉的保存、仍在保存中的编辑器均不得发布。`successfulSaves` 在宿主 `save` 回调成功后递增；`afterSave` 等待绑定文档回显，确保发布 CAS 使用新修订。发布前的样例与真实输出门禁继续由 `templateManager.beforePublish` 执行。

默认 `catalog` 每次读取最新草稿和独立发布版，最多 1000 项，不缓存旧修订。规模更大的生产目录通过 `catalog` 直接传服务端分页 provider，避免拉取全量模板正文；`catalogMetadata` 只补分类和标签。基础能力也可单独使用 `createManagerTemplateCatalog()`、`saveAndPublishReportTemplate()`。

完整参考见 `/platform.html` 与 [PlatformDemo.vue](../examples/minimal/src/PlatformDemo.vue)。业务示例仅处理页面切换、标题、状态和合成数据，通用连接逻辑已进入包内。
