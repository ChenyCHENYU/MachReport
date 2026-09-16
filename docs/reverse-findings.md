# jh4j-cloud-report 逆向发现（持续更新）

> 来源：SIT `https://ytiop-sit.walsin.com.cn:8443/sub/jh4j-cloud-report/assets/` 未压缩产物。
> 已分析 chunk：remoteEntry、reportPreview、api-download、src-api-response、tags-view（含平台 bootstrap）、src-report-grid-renderer（106KB，渲染器核心）。

## 1. 组件模型（gridPlan → pages[].components[]）

```ts
// 几何：绝对定位，mm 单位
comp.leftMm / topMm / widthMm / heightMm: number

// 类型枚举（KNOWN_KINDS）
kind: "text" | "image" | "barcode" | "qrcode" | "chart" | "line" | "rect" | "ellipse"

// 网格组件（与 kind 平级的 grid 字段）
grid: { cells: Cell[][] }   // 二维数组，嵌套子组件深度上限 2（CELL_CHILDREN_MAX_DEPTH）
Cell: { children?: Comp[], rawText?, text? }

// 文本
text.lines?: string[]          // 后端预折行（fontSize pt→px 换算在前端）
text.richParagraphs?: Paragraph[]  // 富文本，richAbsMode 判定绝对定位渲染
text.rawText / text.text       // 原文，内联字段 {ds1.field} 以 segment 形式存在（kind==="field"）

// 图片类（关键发现：barcode/qrcode/chart 由后端渲染成图片下发）
imageData: string              // image/barcode/qrcode/chart 共用，有 imageData 即按图片渲染

// 样式
style: { lineColor, borderColor, lineWidthPt, fontSizePx, fontSize, align, verticalAlign, ... }

// 标识
nid, rkey
```

## 2. 页面模型

```ts
page.pageWidthMm / pageHeightMm: number
page.marginTopMm?: number       // 页眉判定：comp.topMm ≈ marginTopMm（容差 PAGE_TOP_TOL_MM）
page.components: Comp[]
```

## 3. 渲染行为

- mm→px：`(value||0)*mmToPx`，宿主传 `mmToPx = 96/25.4`；mm() 保留 1 位小数，mmExact() 3 位
- 页级虚拟化已存在：`shouldRenderPage(index)` + `heightLocks`（离屏页占位高度锁定）
- shadow DOM 隔离：`useGridShadow()`（reportPreview chunk 实证）
- 富文本 suppressedLeading：页顶组件抑制行首间距
- 图表：ChartPreview 前端绘制（bar/line/pie/scatter/funnel/gauge/legend 命中检测），有独立 SPEC 常量（pt 单位）

## 4. 接口面（已确认）

| 接口 | 用途 |
|---|---|
| GET /report/codePrintReport/gridPlan?tempId=&furnitureTempId=&{params} | 渲染计划（pages） |
| GET /report/codePrintReport/preview?{同上} | PDF（BLOB 响应） |
| GET /report/codePrintReport/export?format=pdf|word|excel|image&{同上} | 导出下载 |
| GET /report/codePrintReport/list | 列表（wl-ui-quality 业务代码引用实证） |
| POST /report/codePrintReport/exportDefinition | 导出定义（body=ID数组） |
| POST /report/codePrintReport/importDefinition | 导入（multipart: file+strategy） |

响应约定：`{ code: 200, message, data }`，code!==200 抛错。

## 5. 组件契约（reportPreview chunk 实证）

props: tempId(null) / furnitureTempId / params({}) / height("100vh") / autoLoad(true) / showExport / showPrint / showPdfWindow(true)
emits: loaded(pageCount) / error(message)
expose: reload / print / exportAs(format) / openPdfWindow / gotoPage(n)
内部：watch JSON.stringify([tempId,furniture,params]) → autoLoad 时 reload；打印走 iframe+blob+30s 兜底；Excel 导出跳 /sheet/preview。

## 6. 待逆向（M0 遗留）

- [ ] 模板保存/读取 JSON 完整 schema（designer chunk，未拉）
- [ ] 列表/发布/数据集 SQL 的接口出入参（reportList chunk 文件名哈希待重取）
- [ ] furniture（页眉页脚）模板与主模板的合成规则
- [ ] 多模板逗号串拼接时 gridPlan 的 pages 合并顺序与 furniture 继承
- [ ] 导出 ZIP 内部结构
