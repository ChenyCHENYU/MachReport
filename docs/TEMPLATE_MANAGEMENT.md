# 模板配置与管理扩展

MachReport 提供模板文档、校验、导入导出、轻量目录、草稿发布管理器和存储适配协议。业务应用连接已有后台或文件存储，预览页面继续只传报表 ID 与参数；包内处理版本和冲突流程，宿主处理权限、审批和持久化事务。

## 最小接入

```ts
import {
  createTableTemplate, defineReportTemplate,
  createTemplateRegistry, machReportPlugin
} from "@agile-team/mach-report/vue";

const templates = createTemplateRegistry([
  defineReportTemplate({
    id: "sales", name: "销售明细", revision: "1",
    template: createTableTemplate({ columns: [
      { header: "商品", field: "name" },
      { header: "金额", field: "amount", format: { kind: "number", digits: 2 } }
    ] })
  })
]);

app.use(machReportPlugin, {
  reports: {
    sales: {
      template: ({ reportId }) => {
        const document = templates.get(reportId);
        if (!document) throw new Error(`模板不存在：${reportId}`);
        return document.template;
      },
      load: ({ params, signal }) => salesApi.report(params, { signal })
    }
  }
});
```

`salesApi.report` 返回 `{ detail: [...] }`；已有接口结构不同则使用 `defineReport({ template, load, mapData })`。页面保持 `<MachReportPreview report-id="sales" :params="query" />`。目录更新后调用 `reload()` 即可读到新版，包内不缓存模板或业务结果。

## 文档协议

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 模板文档协议版本，当前 `1.0`；`defineReportTemplate` 自动填写 |
| `id` / `name` | 必填的稳定模板标识与显示名称 |
| `revision` | 可选字符串；轻量目录由宿主管理，使用 Manager 时由管理器生成修订 token |
| `description` | 可选描述 |
| `template` | 普通 `ReportTemplate`：页面、参数、组件与列配置 |

文档协议版本与布局/渲染计划协议独立。业务接口地址、脚本、数据集和凭据不放入文档；数据访问函数继续注册在受控应用代码中。读取返回独立快照，修改草稿不会偷偷改变已经注册的模板。

```ts
import { parseReportTemplate, serializeReportTemplate } from "@agile-team/mach-report";

const document = parseReportTemplate(await templateApi.read("sales"));
templates.register(document, { replace: true });
await templateApi.save(serializeReportTemplate(document), {
  expectedRevision: document.revision
});
```

`templateApi` 是宿主已有客户端，示例不规定接口路径或 HTTP 方法。`replace:true` 只控制本地重复 ID，不是服务器的并发保护；服务器须比较 `expectedRevision`，拒绝过期编辑，并返回新修订号。

## 动态后台加载

```ts
reports: {
  sales: {
    params: [{ field: "date", label: "日期", type: "date", required: true }],
    template: async ({ reportId, signal }) =>
      parseReportTemplate(await templateApi.read(reportId, { signal })).template,
    load: ({ params, signal }) => salesApi.report(params, { signal })
  }
}
```

模板和数据沿用同一请求上下文与取消信号。动态模板不合法时先停止，不调用业务数据接口。切换单据或卸载会取消旧流程，即便业务客户端忽略 signal，旧结果也不会继续排版。报表 ID 与参数在调用入口快照，异步等待期间外部修改不影响本次口径。

参数面板需要同步元数据，因此动态模板把可查询的 `params` 放在报表定义；异步返回模板里的参数不会自动改写已经显示的查询面板。具体发布版本、厂别/租户选择及读取权限由后台校验；不要使用不含权限上下文的全局结果缓存。

## 草稿、发布与历史管理器

需要版本管理时，使用同一核心入口的 `createTemplateManager`；普通静态目录继续使用 `createTemplateRegistry`，无需为简单报表引入发布流程。

```ts
import {
  createMemoryTemplateStore, createTemplateManager,
  createTableTemplate, defineReportTemplate
} from "@agile-team/mach-report";

const manager = createTemplateManager(createMemoryTemplateStore());
const document = defineReportTemplate({
  id: "sales", name: "销售明细",
  template: createTableTemplate({ columns: [{ header: "商品", field: "name" }] })
});
const draft = await manager.saveDraft(document, { expectedRevision: null });
const published = await manager.publish("sales", { expectedRevision: draft.revision });
const active = await manager.get("sales");
const history = await manager.history("sales");
// 恢复历史内容为新发布修订，旧历史保持不变。
const restored = await manager.rollback("sales", published.revision, {
  expectedRevision: published.revision
});
```

`saveDraft/publish/rollback` 返回当前状态 `{ id, revision, draft?, publishedRevision?, published? }`。新建的 `expectedRevision` 必须是 `null`；后续修改必须提供刚读取的状态修订。冲突抛 `ReportTemplateStoreError`，`code="conflict"`，不能自动覆盖或重试成最后写入者胜出。

`manager.get(id)` 默认只返回已发布文档；`get(id,{draft:true})` 返回草稿。修改草稿不会改变线上版本。每次草稿写入和发布都会增加状态修订；发布历史只记录发布动作，因此发布修订不保证连续。发布和回滚会清除该状态的草稿；回滚记录 `restoredFrom`，产生新修订，不重写旧版。

历史版本包含 `{ revision, publishedAt, document, restoredFrom? }`。读取文档、状态与历史都返回独立快照，调用方修改返回对象不会污染存储。取消在原子写入前检查；CAS 已成功时不会因迟到的取消误报“没有保存”。

## 持久化适配器与 CAS

内存存储是单进程参考实现，重启后数据消失。生产实现 `ReportTemplateStore` 即可接现有数据库或文件服务，不绑定 ORM、HTTP 框架或表名：

| 适配方法 | 要求 |
| --- | --- |
| `read(id,signal?)` | 读取当前状态，不带完整历史数组 |
| `list(signal?)` | 只返回 `id/revision/publishedRevision` 目录元数据 |
| `history(id,signal?)` | 显式读取该模板的发布历史 |
| `getVersion(id,revision,signal?)` | 读取单个不可变历史版本，供回滚使用 |
| `compareAndSwap(id,expectedRevision,next,{publication?,signal?})` | 原子比较修订、写当前状态，并在有 `publication` 时追加历史；竞争失败返回 `false` |

状态与历史分离：保存草稿和发布不读取全量历史，回滚只读取所选版本。数据库适配器可以把状态和历史放在各自的表中，在同一事务中完成“更新状态 + 插入发布历史”。首次创建依赖唯一 ID 约束；更新依赖 `WHERE revision = expectedRevision` 或等价原子操作；历史修订禁止覆盖。不能用“先 SELECT，再无条件 UPDATE”代替 CAS。

存储适配器负责事务和原子性，管理器负责状态转换与模板校验；租户隔离、权限、审批和审计人员信息仍由宿主业务层提供。模板修订不是数据库主键，也不能代替业务数据的 `revision/sourceToken`。

## 显式文档迁移

未知文档版本默认拒绝。存在受控的历史格式时，注册显式迁移 Hook；迁移后的结果仍经过完整文档校验：

```ts
const manager = createTemplateManager(store, {
  migrate: async (input) => migrateKnownTemplateVersions(input)
});
await manager.saveDraft(oldDocument, { expectedRevision: null });
```

`store`、`migrateKnownTemplateVersions` 由宿主提供；只迁移明确支持的旧格式，不执行模板中携带的脚本。迁移 Hook 作用于 `saveDraft`，不会自动修改已发布历史。`now` 可注入发布时钟，便于可复现测试。

## 管理页面与可选能力

| 阶段 | 宿主能力 | 插件承接 |
| --- | --- | --- |
| 文件与配置 | 模板 JSON 导入、下载、选择 | parse/serialize、目录、结构校验 |
| 管理页面 | 查询、编辑草稿、保存、预览 | 结构化错误路径、模板预览、目录快照 |
| 发布管理 | 审批、审计、持久化事务 | Manager 的草稿/发布状态与 CAS |
| 历史与回滚 | 历史选择与恢复确认 | 不可变发布版本、恢复旧版为新修订 |
| 多租户 | 模板范围、读写权限、版本冲突 | 宿主客户端提供权限上下文，引擎无数据库绑定 |

业务管理后台和数据库表由宿主实施；本包不会自动写库。可选 `/designer` 提供[画布与属性编辑](./DESIGNER.md)、Excel绑定、规则和变更验收，使用保存回调连接Manager或现有版本服务。无Vue的后台仍可直接使用核心Manager。

Manager可配置 `beforePublish({ document, previous, signal })` 门禁，发布和回滚都在CAS前执行。核心 `reviewReportTemplate`检查字段依赖、语义差异和显式样例；服务端 `reviewReportPublication`还真实编码PDF/XLSX并可归档摘要。失败保留草稿；并发修改继续由CAS拒绝覆盖。详细流程见[发布验收](./PUBLICATION_REVIEW.md)，运行时与Worker见[SERVER.md](./SERVER.md)。

## 校验与兼容

`validateReportTemplate` 和 `validateReportTemplateDocument` 返回 `{ ok, errors, warnings }`；错误含字段路径，适合管理页面定位。创建、解析和注册失败抛 `ReportTemplateError`，原数据不会被替换。

导入接受 JSON 文本或普通 JSON 对象；拒绝未知文档版本、未知文档根字段、函数、访问器、循环、危险键、特殊原型和稀疏数组。文档限制为1000万字符、20万 JSON 节点、64层嵌套；多行合并表头还限制逻辑网格不超过20万格，避免小 JSON 通过巨大跨度放大校验成本。对象会完整校验后再复制，不执行模板脚本。网络响应大小和业务数据范围仍由宿主控制。

原有静态 `ReportDefinition.template` 保持2.1兼容，包括显式 undefined 的可选属性；新导入/动态文档遵循纯 JSON 契约。导出前如果静态模板带 undefined，应用应去掉未配置字段；序列化不会静默丢弃非法值。
