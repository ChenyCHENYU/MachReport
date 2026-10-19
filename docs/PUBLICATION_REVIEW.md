# 模板变更与发布验收

浏览器的“工具 → 变更与验收”对比当前草稿与载入基线，按信息、结构、字段、计算和样式分组展示差异。列重排与字段删除分别处理；删除整张明细区域也提示兼容风险。检查结果能定位回具体组件或字段。确认兼容性只影响本地检查，不授予发布权限。

`reviewReportTemplate` 是零依赖的结构 / 字段 / 样例排版预检，不生成二进制文件。它检查显示字段，也检查公式输入、关联键、条件与矩阵源字段。仅校验被模板引用的数据集，避免未使用的可选数据集阻断发布。

```ts
import { reviewReportTemplate } from '@agile-team/mach-report';
const review = reviewReportTemplate(draft, {
  previous: published,
  dataSchemas,
  fixtures: [{ name: '零值与空值', datasets: sampleDatasets }],
  maxSampleRows: 1000,
  maxPages: 100,
  maxCells: 250_000
});
```

样例必须显式提供，不查询业务接口。浏览器可选每个数据集前20行、前100行、仅结构或全部当前数据，样例总量上限默认1000行；不静默截断全量数据并冒充完整验收。没有样例会明确标记尚未验证排版和输出。默认最多20组样例、100页、25万渲染格。

## 服务端真实文件验收

`/server` 的 `reviewReportPublication` 先做同一预检，再依次真实生成PDF/XLSX。默认返回文件大小、页数与可选摘要，文件字节通过 `onArtifact` 交给宿主归档，结果不保留所有文件内容。实际编码、预算或归档失败均使 `ok=false`。中文PDF需显式传入授权字体；`strictOutputs: true` 可把已识别的输出降级阻断为错误。

```ts
import { createTemplateManager } from '@agile-team/mach-report';
import { reviewReportPublication } from '@agile-team/mach-report/server';
import { reportArtifactSha256 } from '@agile-team/mach-report/server/node';

const manager = createTemplateManager(store, {
  beforePublish: ({ document, previous, signal }) => reviewReportPublication(document, {
    previous, signal, dataSchemas,
    fixtures: acceptanceFixtures, // 由项目维护空表、正常、跨页、边界值等脱敏样例
    formats: ['pdf', 'xlsx'],
    pdf: { customFontBytes: licensedFont },
    xlsx: { valueMode: 'raw' },
    digest: reportArtifactSha256,
    onArtifact: (name, result) => archivePreview(name, result)
  })
});
```

`store` 是项目原子CAS适配器，`archivePreview` 是项目受控归档函数；包不创建接口或数据库表。发布与回滚都先执行此门禁，再按原预期修订CAS提交；验收失败保留草稿。并发修改会触发冲突，不能用验收成功覆盖另一人的草稿。归档应写入临时或候选区，以便CAS冲突时回收尚未发布的文件。

默认单文件上限2000万字节、每个输出含摘要和归档回调的整体期限30秒。输出字节预算在文件生成后核对，时间取消是协作式；需要硬终止时使用Node Worker。`params` 可随各组fixture提供，支持带必填查询参数的模板。样例验收不证明全量业务数据都符合规则，真实查询仍应执行Runtime预算、权限和字段契约。
