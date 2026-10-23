# 打印准备与来源数据说明

预览、业务数据解释和物理打印分工明确：包内负责资源准备、定位及毫米布局，宿主声明业务原因和字体地址。现有只传模板与数据的页面无需新增配置。

## 可靠的打印交付

打印 iframe 建立后，引擎等待该文档的字体就绪与所有图片解码，再打开系统打印对话框。图片以最多 4 路并发准备；资源失败、超时或取消时停止交付，避免打印缺码、缺图的页面。默认总准备超时为 15 秒，可配置为 1–120000 毫秒。切换报表、取消任务及卸载会清理准备中的任务。

需要下载字体时，在应用注册处配置一次：

```ts
provideMachReportConfig({
  defaults: {
    printOptions: {
      resourceTimeoutMs: 15000,
      fonts: [{ family: 'Report Sans', source: '/fonts/report-sans.otf' }],
      calibration: { offsetXmm: 0, offsetYmm: 0 },
    },
  },
});
```

模板内容的 `style.fontFamily` 应使用相同名称。字体 URL 支持相对地址或 HTTP(S)，仍遵守浏览器 CORS 和访问权限；只接受最多 8 个字体声明，复用字体下载缓存和预算，不加载 PDF 编码器。字体通过打印文档自身的 `FontFace` 加载和校验；不能只用主页面字体已加载来推断打印文档也准备完毕。

`ReportPreview` 也可单独传 `print-options`，覆盖应用默认值；`ReportPrintOptions`、`preparePrintResources` 和 `createPrintCalibrationPlan` 从 `/vue` 导出。常规页面继续调用 `useMachReport().print()`，无需管理 iframe、图片事件和超时。

## 设置中的打印校准

“设置 → 打印校准”提供水平、垂直偏移，范围为 ±20 mm。正值向右、向下移动内容；不修改模板纸张尺寸、分页、PDF 或 Excel。输入无效时保留上一有效值。当前会话的偏移不自动跨设备保存；宿主需要保存设备偏好时，可将校准值作为自己的 `printOptions` 默认值。

固定页面的宽高在 25–600 mm 时，可打印同规格校准页，核对毫米标尺与正方形。完整宽表不能直接用校准页假定为标准纸张。请在打印驱动中选择对应纸型及 100% 比例；超出物理纸张的内容会受纸张边界限制，校准不能替代驱动的可打印区域设置。

系统对话框关闭只表示浏览器已交付或取消，不证明设备已打印、扫码通过或完成硬件双面。设备状态、静默打印和驱动控制需要独立设备适配器，不在此接口中虚构成功状态。批量标签的 A4 拼版和服务端归档见[交付 API](DELIVERY.md)。

## 声明空值的业务原因

包不会把空值猜测为来源缺失，也不会把 `0` 转为空。需要解释时，业务查询结果的 `diagnostics` 增加可选 `valueState` 和 `target`：

```ts
const provider = {
  query: async () => ({
    datasets: { detail: [{ id: '0001', weight: 0 }, { id: '0002', weight: null }] },
    diagnostics: [{
      code: 'weight-source', severity: 'info',
      message: '该物料尚无称重实绩，待称重后可重新查询。',
      valueState: 'missing-source',
      target: { datasetId: 'detail', field: 'weight', rowKey: '0002' },
    }],
  }),
};
```

| `valueState` | 业务含义 |
| --- | --- |
| `missing-source` | 暂无业务来源 |
| `not-applicable` | 该记录不适用此字段 |
| `not-calculable` | 业务条件不足，当前无法计算 |

`target` 使用声明数据集、字段与可选稳定业务 `rowKey`、`tableId`；字符串主键保留前导零，数字主键保留真实 `0`。`rowKey` 定位要求列表声明对应主键，定位失败会明确反馈，不静默跳到另一条记录。

`createReportSource` 自动隔离多张报表以及重复报表 ID 的作用域，业务无需手写命名空间；`tableId` 仍填写模板原始表身份。旧自定义 fetcher 的 `onQueryResult(id, result)` 可继续使用；同一 ID 重复出现时，应补传可选的第三个报表索引，否则歧义目标会报告未找到，避免误选其他报表的数据。

有解释时，预览只增加一条默认折叠的“来源数据说明”摘要。展开后可按原因、字段和主键搜索，最多挂载 100 条解释；输入更具体的查询可定位其余结果。普通输出告警独立展示。重新查询清理旧说明，导出数据和原始数值保持不变。

状态和目标结构均经过校验。错误类型、非法数据结构及越界数据仍按原校验报错，不能伪装成“暂无来源”。没有新增元数据的旧接口完全兼容。
