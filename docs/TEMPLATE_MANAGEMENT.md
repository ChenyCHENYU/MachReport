# 模板配置与管理扩展

MachReport 提供模板文档、校验、导入导出、内存目录和动态加载。业务应用可以连接已有后台或文件存储，预览页面继续只传报表 ID 与参数；保存、发布和权限放在宿主的业务流程中。

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
| `revision` | 可选字符串，由宿主管理发布版本或乐观锁标识 |
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

## 后台功能如何逐步增加

| 阶段 | 宿主能力 | 插件承接 |
| --- | --- | --- |
| 文件与配置 | 模板 JSON 导入、下载、选择 | parse/serialize、目录、结构校验 |
| 管理页面 | 查询、编辑草稿、保存、预览 | 结构化错误路径、模板预览、目录快照 |
| 发布管理 | 草稿与已发布版本分离、审批、审计 | 稳定 ID/revision、动态模板加载 |
| 历史与回滚 | 不可变历史版本、恢复旧版为新修订 | 相同报表入口重新加载所选版本 |
| 多租户 | 模板范围、读写权限、版本冲突 | 宿主客户端提供权限上下文，引擎无数据库绑定 |

以上管理页面和服务由宿主实施；本包不内置管理控制台、数据库表或自动写库行为。可视化拖拽设计器仍是独立能力，JSON 模板接口可以作为后续设计器的输出协议。

## 校验与兼容

`validateReportTemplate` 和 `validateReportTemplateDocument` 返回 `{ ok, errors, warnings }`；错误含字段路径，适合管理页面定位。创建、解析和注册失败抛 `ReportTemplateError`，原数据不会被替换。

导入接受 JSON 文本或普通 JSON 对象；拒绝未知文档版本、未知文档根字段、函数、访问器、循环、危险键、特殊原型和稀疏数组。文档限制为1000万字符、20万 JSON 节点、64层嵌套。对象会完整校验后再复制，不执行模板脚本。网络响应大小和业务数据范围仍由宿主控制。

原有静态 `ReportDefinition.template` 保持2.1兼容，包括显式 undefined 的可选属性；新导入/动态文档遵循纯 JSON 契约。导出前如果静态模板带 undefined，应用应去掉未配置字段；序列化不会静默丢弃非法值。
