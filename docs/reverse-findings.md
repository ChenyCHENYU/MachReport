# jh4j-cloud-report 逆向发现（持续更新）

> 来源：公司 SIT 环境 jh4j-cloud-report 前端未压缩产物（内部资料，勿外发具体环境地址）。
> 已分析 chunk：remoteEntry、reportPreview、api-download、src-api-response、tags-view（含平台 bootstrap）、src-report-grid-renderer（106KB 渲染器核心）、designer（1.96MB 设计器全量）。

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

## 6. 模板存储与设计器（designer chunk 逆向，1.96MB 已分析）

### 保存链路
- 模板保存：`PUT /report/codePrintReport/update`，body `{ id, code, name, content }`
- `content` = `JSON.stringify(exportBackendPrintConfig(...))` —— 模板本体是序列化字符串
- 读取：`/report/codePrintReport/getById`；数据集 `/report/codePrintReportDs/list`；参数 `/report/codePrintReportParam/list?reportId=&current=1&size=999`
- 导入 Word/Excel 模板：`/report/codePrintReport/importTemplateContent`
- **模板锁**（解决双标签页并发编辑）：`/report/codePrintReportLock/{acquire|heartbeat|release|status}`，心跳 40s

### 模板 content JSON 结构（私有格式，PascalCase 混合）
```ts
// 根节点
{
  nid, uikey, ReportCreated: number(ts), pageTemplateCircle: true,
  uitype: "tempContent", tenantPageCode: string, IsImgBGFlag, IsMainSubRelation,
  GlobalConfig: {
    paperSizeMode: "preset" | "custom", paperPreset: string,
    paperWidthMm, paperHeightMm, marginTop/Bottom/Left/Right (mm),
    backgroundImage, backgroundImageConfig,
    watermarkEnabled, watermark: { text, textEn, dataType, fontFamily("黑体"),
      fontTtf("SIMHEI.TTF"), fontSize(24), color, rotate(45), gapX(120), gapY(80) },
    pageRepeatMode, pageRepeatCount(1..N), // 一单多打
    ...batchPaperConfig
  },
  children: PageNode[]
}

// 页节点
{
  nid, uitype: "page", Unit: "mm", show: true, Printable: true,
  PaperSize: preset名 | "Custom", width(mm), DesignHeight(mm),
  MarginTop/Right/Bottom/Left(mm), marginTopMm,
  "__print_pageheader_height": 0, "__print_pagefooter_height": 0,
  uititle: 页名, uiisview: true,
  children: ElementNode[]  // 按 zIndex 排序
}
```

### 对 MachReport 的结论
1. jh4j 模板是**私有历史格式**（PascalCase、魔法键名、`{pageNid}uititle` 动态键）——完整兼容成本高且无必要
2. 策略确认：自研干净格式（ReportTemplate）为主，`importJh4jContent()` 单向转换器为辅（M3 里程碑）
3. 模板锁机制值得复刻（40s 心跳 + acquire/release），解决手册 2.x 的双标签页痛点
