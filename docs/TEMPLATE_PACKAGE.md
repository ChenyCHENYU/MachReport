# 可搬运模板包

可选 `/server` 入口提供纯 JSON 模板包。它携带独立模板文档、字段契约、最低 SDK 版本、显式脱敏样例，以及字体和 Logo 的依赖清单。资源字节留在宿主授权的存储中，由 resolver 按清单取得并核验。无需 ZIP 库，也不会携带数据库连接、接口鉴权或自动注册、保存、发布模板。

```ts
import {
  createReportTemplatePackage,
  resolveReportTemplatePackage,
  reportPackageResourceDigest,
} from "@agile-team/mach-report/server";

const bundle = createReportTemplatePackage({
  document,
  contracts: dataSchema,
  resources: [{
    id: "company-logo",
    kind: "image",
    mediaType: "image/png",
    bytes: logoBytes.byteLength,
    sha256: reportPackageResourceDigest(logoBytes),
    targets: [{ pageIndex: 0, componentPath: [0] }],
  }],
  fixtures: [{
    name: "脱敏零值样例",
    deidentified: true,
    datasets: { detail: [{ id: "SAMPLE-001", amount: 0 }] },
  }],
});
const json = JSON.stringify(bundle);

const imported = await resolveReportTemplatePackage(json, {
  resolve: async (resource, { signal }) => ({
    bytes: await authorizedAssets.read(resource.id, { signal }),
    mediaType: resource.mediaType,
  }),
  signal,
});
// imported.document 交给设计器或模板管理器，用户确认后正常 CAS 保存。
// imported.contracts 用于 Provider 数据校验；imported.fixtures 用于模板验收。
// imported.fonts 是已验证的独立字体字节，宿主按 family/face 配置字体。
```

创建时，指定图片位置的内嵌 `imageData` 从包文档移除，宿主原文档保持不变；导入核验成功后再补回。`componentPath` 第一项是顶层组件序号，后续按“网格行、格、子组件”三项一组定位；只能指向静态图片组件，不能覆盖数据绑定图片。PNG/JPEG 支持，SVG/脚本不接受。字体清单使用 `kind: "font"`、`font/ttf` 或 `font/otf`，并声明 `font: { family, face }`；四种 face 为 `regular/bold/italic/boldItalic`。许可说明可记录在 `license`，实际跨环境使用许可由宿主确认。

最低版本默认捕获创建包时的实际 SDK 版本，导入默认与当前 SDK 比较。确知向后兼容时可显式指定 `minimumVersion`；检查另一部署目标时可传 `runtimeVersion`，只接受正式 `x.y.z` 版本。该检查不会自动迁移未来版本的未知模板结构。

`parseReportTemplatePackage(json)` 仅验证清单并返回独立快照，不调用 resolver。`resolveReportTemplatePackage()` 顺序解析依赖：检查返回类型、实际字节数、PNG/JPEG/字体头和 SHA256，再恢复图片和返回字体。图片共用导出层的尺寸及像素预算；摘要验证不能代替最终字体排版、扫码或真实打印验收，发布前仍应运行 `reviewReportPublication()`。

| 边界 | 默认 / 上限 |
| --- | --- |
| JSON 字节 | 默认 8 MB，可显式设 `maxBytes`，最多 32 MB |
| 外部资源 | 最多 64 项，单项最多 32 MB |
| 资源总字节 | 内嵌图片与外部依赖合计默认 32 MB，可设 `maxResourceBytes`，最多 64 MB |
| 图片 | 共用单图 16 MiB、1600 万像素、边长 16384、合计 6400 万像素预算 |
| 字段契约 | 最多 100 个数据集，每项沿用核心字段契约校验 |
| 样例 | 最多 20 个，每个最多 1000 行（含嵌套树所有节点）；名称唯一、`deidentified: true` 必须显式给出 |
| 资源加载 | 总超时默认 30 秒，可设 `maxDurationMs`；取消或超时停止后续解析 |

样例没有默认取数路径，不会自动把当前预览数据写进包；SDK 不能判断业务内容是否已匿名，必须由调用方提供已脱敏数据。包拒绝访问器、循环、危险键、未知包字段以及重复资源/图片位置/字体 family+face。resolver 得到清单副本，不能通过修改摘要跳过核验。失败不返回部分导入结果；没有隐式网络或业务落库动作。
