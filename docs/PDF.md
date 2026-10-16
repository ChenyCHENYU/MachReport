# PDF 字体与首次导出

中文 PDF 需要项目部署覆盖实际报表文字的字体，并配置 `pdfFontUrl`。MachReport 不自动下载公共字库；仓库示例字体只覆盖示例文字，不能作为生产字库。

## 配置一次

```ts
import { defineMachReportConfig, machReportPlugin } from "@agile-team/mach-report/vue";

app.use(machReportPlugin, {
  reports,
  config: defineMachReportConfig({
    defaults: { pdfFontUrl: "/fonts/report-v1.otf" }
  })
});
```

将字体放入项目的静态资源目录或可访问的资源服务；可用有效 TTF / OTF 等 fontkit 支持的单字体文件。确认授权允许部署和嵌入。字体 URL 应直接返回字体字节，不能返回 HTML 路由回退或 JSON 错误页。跨域字体服务需要允许浏览器访问，包括 HEAD 和实际 GET。默认 URL `/simhei.ttf` 为兼容保留，需要宿主提供该文件；推荐显式配置。

纯西文报表可将 `pdfFontUrl` 设为 `""`，使用 PDF 内置字体。内置字体无法覆盖中文等文字，仍会在导出时检查。字体部署与实际导出均不影响后端接口约定。

## 轻量预检与只读状态

组件加载有效页面后，只要 PDF 导出或 PDF 窗口入口显示，就自动发起 HEAD 检查。预检不下载字体正文、不加载 PDF 引擎、不阻塞报表预览。不同组件对同一 URL 共享请求；切换 URL、清理计划或卸载会取消当前订阅，无订阅时取消网络请求。检查超时为 15 秒，成功结果在当前页面会话内复用。

```ts
const report = useMachReport();
const { state } = report; // 模板可直接读取 state.pdfFont.status
const result = await report.checkPdfFont();
```

主动检查可重试失败结果。组件提供通用提示与重试按钮，详细 URL、原因供宿主从 `state.pdfFont` 读取；提示文案可通过 `messages.pdfFontUnavailable` 配置。字体预检错误单独记录，不进入普通操作的 `state.error` 或 `error` 事件。

| `status` | 含义与后续行为 |
| --- | --- |
| `unchecked` | 还未检查；例如没有有效页面或 PDF 操作未显示 |
| `checking` | 正在检查响应头 |
| `available` | 资源可达且不是明显的文本错误页；实际导出仍检查字体有效性与字符覆盖 |
| `disabled` | 空 URL，不加载自定义字体 |
| `unverified` | 服务不支持 HEAD（405 / 501），或自定义导出器未提供检查；仍可尝试导出 |
| `error` | HTTP 错误、文本响应、网络 / 跨域问题或超时；修复后重试 |

`checkPdfFont()` 因生命周期取消时拒绝 `AbortError`，宿主主动调用时应按自己的页面生命周期处理。旧版自定义 `PdfExporter` 函数继续支持；可选增加 `checkFont(signal?)` 返回 `PdfFontCheckResult`。自定义导出器需要自行确保输出正确性。

## 实际导出与缓存

首次导出才懒加载 `/pdf` 并 GET 字体。默认导出器严格检查文件签名并用 fontkit 解析，随后才进入内存 / IndexedDB 缓存。错误、截断或不合法的旧缓存会被删除并重新请求同一 URL。无 IndexedDB 的环境仍可使用内存缓存。

自定义字体绘制前检查文字所需的 Unicode 字符；缺字、字体解析失败或页面渲染失败时，Vue 默认导出器报告 `pdf` 错误并阻止残缺文件下载。`available` 无法保证业务数据中的每个字都受支持；生产字库应覆盖实际数据中的汉字、生僻字和其他字符，并验证真实单据。

从 2.3.2 起，自定义字体完整嵌入提供的字体文件，避免部分中文 OTF 字体经 fontkit 子集化后丢失字形映射。完整字库会增加 PDF 文件体积；字体字节缓存仍可复用，PDF 中的嵌入字体也由同一文档的页面共享。宿主仍只需配置 `pdfFontUrl`。若使用自行裁剪的字库，应覆盖实际数据所用字符；完整嵌入无法补回源文件中不存在的字形。

更换字库推荐使用带版本的 URL，避免浏览器、CDN 与持久缓存继续复用旧内容。必须沿用同一 URL 时，可主动清理 MachReport 字体缓存后重新导出：

```ts
import { invalidateFontCache } from "@agile-team/mach-report/pdf";

await invalidateFontCache("/fonts/report.otf");
```

此方法清理该 URL 的内存与 IndexedDB 字节缓存，不清理浏览器 HTTP / CDN 缓存，也不重置轻量 HEAD 成功记录。字体预检和实际字节缓存各自服务不同阶段，生产更新以版本 URL 为优先方案。

引擎调用 `loadFontWithCache(url)` 默认保留旧的 `Uint8Array | null` 兼容行为；需要提前失败时使用 `{ strict: true }`。直接调用 `renderPlanToPdf` 应检查结果的 `unsupportedTextCount`、`pageErrors` 和 `fidelityWarnings`，并由应用决定是否接受输出。Vue 默认导出器已包含这些判定。

## 前后端共用字体度量

`TextMeasureOptions` 同时包含字号、字体族、粗体、斜体和字距。浏览器可用 `createCanvasMeasurer`，Node 可从 `/pdf` 使用 `createFontBytesMeasurer`；后者按实际字体 advance 度量，不依赖 DOM。分页和输出应传入同一实例：

```ts
import { paginateTemplate } from "@agile-team/mach-report";
import { createFontBytesMeasurer, renderPlanToPdf } from "@agile-team/mach-report/pdf";

const faces = { regular: regularBytes, bold: boldBytes }; // 已取得的字体字节
const measurer = createFontBytesMeasurer(faces);
const { plan } = paginateTemplate(template, datasets, { measurer });
const result = await renderPlanToPdf(plan, {
  customFontFaces: faces,
  measurer,
  signal
});
```

`customFontFaces` 支持 `regular / bold / italic / boldItalic`。缺少的字面回退 regular 并返回保真告警，不合成粗斜字体；旧 `customFontBytes` 保持兼容。相同字节对象的解析采用弱引用缓存，同一 PDF 内重复字面不重复嵌入；传入后不要修改字节内容。字体度量器可选 `fontFamily` 作为匹配保护，其他字体族走指定 `fallback`；多字体报表仍需按实际字体配置和验收。

PDF 与 Canvas 已应用 `letterSpacing`，按 Unicode 码点之间的间隔计算，末字后不附加字距。复杂脚本、组合字符、浏览器字体回退仍可能受实际字体排版影响；共享字库和测量器可减少折行差异，不能保证任意字体环境下像素一致。

## 可选图片、二维码与图表适配器

原生图片、已有二维码或外部图表渲染结果均通过 `imageData` 输出。PDF 接受 PNG / JPEG 的 base64 data URL，SVG 或远程 URL 应先由适配器转换，不能直接承诺保真。高级图表或条码库按需接入，无需进入主入口依赖：

```ts
const result = await renderPlanToPdf(plan, {
  customFontFaces: faces,
  assetRenderers: {
    qrcode: async ({ component, signal }) => {
      return qrRenderer.toPngDataUrl(component.meta, { signal });
    }
  },
  assetBudget: { maxAssets: 500, maxDurationMs: 30_000 },
  onDiagnostic: (diagnostic) => reportDiagnostic(diagnostic),
  signal
});
```

也可在任何输出前调用核心 `resolvePlanAssets(plan, options)`，随后把返回的 `plan` 交给各渲染器。已有 `imageData` 不重复生成；未变页和组件保留引用，输入计划不被修改。网格子组件递归准备资产，但 PDF / Canvas 当前仍明确告警省略子组件，资产准备本身不会使原先未支持的布局自动获得支持。

适配器默认失败即拒绝导出，错误为带 `diagnostic` 的 `OutputAssetError`；只有显式 `assetFailure: "placeholder"` 才保留占位组件并返回告警。默认预算为 1000 个新资产、每个 32 MiB 图像负载、合计 128 MiB、30 秒；`signal` 可取消等待，即使适配器忽略取消，也不会把迟到结果写回原计划。适配器自身资源仍应响应传入的 signal。

结果新增结构化 `diagnostics`，包含格式、页号索引、组件索引、类型及错误码；`fidelityWarnings` 继续兼容。`inspectOutputCapabilities(plan, "pdf")` 可在加载 PDF 引擎前检查静态能力，图片解码和字体覆盖仍由实际导出核实。PDF 页面、字体和最终字节仍在内存中生成，取消在异步准备及组件 / 页面边界生效，不能中断底层库正在执行的同步操作。

PDF / XLSX 为独立按需入口；只读状态、HEAD 诊断和普通预览不会提前加载两种导出引擎。接口取数和组件接入见 [项目接入指南](./INTEGRATION.md)。
