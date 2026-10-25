# 业务组件扩展

使用 `createReportComponentRegistry` 把业务印章、品牌图形或其他图像组件接入同一条预览、Canvas、PDF、Excel 输出管线。注册器按 `id + version` 识别模板组件；多个扩展可以使用相同的原生 `kind`，不需要增加 `ComponentKind` 或分别修改各输出实现。

## 一次注册，沿用 assets 接入

```ts
import { createReportComponentRegistry } from '@agile-team/mach-report';

const components = createReportComponentRegistry([{
  id: 'business.approval-stamp',
  version: '1.0.0',
  kind: 'image',
  label: '审批印章',
  properties: {
    caption: { label: '印章文字', type: 'string', required: true, maxLength: 20 },
    showDate: { label: '显示日期', type: 'boolean', default: false },
  },
  load: () => import('./stamp-renderer'),
}]);

const stamp = {
  ...components.createComponent('business.approval-stamp', {
    props: { caption: '已核准' },
    binding: { approvalId: 'approval-001' },
  }),
  leftMm: 12, topMm: 20, widthMm: 30, heightMm: 18,
};
```

`stamp-renderer` 是宿主明确编写和打包的模块，导出 `render(context)`，可选导出 `dispose()`。`render` 接收 `ReportComponentExtensionContext`，读取已校验的 `extension.props`、`extension.binding` 及 `signal`，返回自包含 PNG/JPEG data URL。宿主可以复用自己的图形库；核心不加载图表库、执行模板脚本或根据模板字符串动态导入模块。

```vue
<ReportPreview :reports="reports" report-id="daily" :assets="components.assets" />
```

```ts
import { createReportRuntime } from '@agile-team/mach-report/server';

const runtime = createReportRuntime({ reports, assets: components.assets });
const prepared = await runtime.prepare({ reportIds: ['daily'] });
// prepared.plan 已带自包含 imageData，后续输出复用同一次组件结果。
```

`reports` 中的模板使用上面的 `stamp`。直接使用核心时，调用 `resolvePlanAssets(plan, components.assets)`；直接 PDF/Excel 输出同样接受此 `assets` 配置。Worker 应在其执行器内部注册运行时模块，不能把加载函数通过模板 JSON 或 RPC 传输。

## 在现有设计器中插入

```ts
import { ref } from 'vue';
import type { TemplateEditorController } from '@agile-team/mach-report/designer';

const editor = ref<TemplateEditorController>();
editor.value?.insertComponent(stamp);
```

```vue
<ReportTemplateEditor
  ref="editor"
  v-model="document"
  :preview="{ assets: components.assets }"
/>
```

插入复用现有画布事务：校验并复制宿主组件、约束页面几何、选中新对象、记录撤销/重做。只读、草稿阻塞及区域托管页面继续遵守原约束；失败返回 `false`，通过现有错误区域说明原因。插入后可使用已有的选择、拖动、尺寸、对齐、锁定和层级功能，不需要维护第二套画布状态。

`components.describe(kind?)` 返回不可变的属性元数据，业务工具可据此只显示适用字段；不会触发模块加载。属性支持文本、数字、布尔值、必填、默认值、候选值、范围和长度；必填且无默认值的属性应在业务工具收集后再创建组件。

## 与现有适配器协作

```ts
import { createCodeAssetRenderers } from '@agile-team/mach-report/codes';

const assets = {
  ...components.assets,
  assetRenderers: createCodeAssetRenderers(),
};
```

有 `meta.componentExtension` 的组件由注册器精确派发；未绑定扩展的组件继续由已有 `assetRenderers` 按原生类型处理。原来的类型适配器仍适合统一条码、二维码等场景，注册器适合需要多个业务组件身份、版本和属性定义的场景，二者共用资产解析与预算机制。

## 版本、取消与释放

- 每个注册器最多 128 个扩展，同一 `id` 只能登记一个明确版本；导入模板版本或原生类型不匹配时明确报错，不静默替换。
- 模板中仅保存属性和不透明业务绑定。绑定最多 2048 个节点、16 层、64 Ki UTF-16 数据，拒绝 getter、函数、危险键及非有限数值；核心不执行其中的查询、属性路径或代码。
- 同一模块并发加载一次，失败可在下一次明确操作中重试。单个查询取消不会取消其他使用者的共同加载，渲染继续接收独立取消信号。
- 宿主拥有注册器生命周期。页面独占时在卸载时 `await components.dispose()`；多个预览共享时在共同拥有者退出时释放。已加载模块释放一次；未结束的加载不阻塞销毁，晚到资源会立即释放。销毁后拒绝新工作。
- 错误沿用资产诊断，包含页、组件及嵌套路径；具体原因保留在 `OutputAssetError.cause`。默认阻止缺失组件的输出，需要占位预览时显式配置 `assetFailure: 'placeholder'`，严格输出规则仍适用。

此契约覆盖现有图像型扩展。它不开放任意脚本组件，不将图像伪装成原生 Excel 单元格，也不保证自定义图形本身的业务正确性；宿主渲染器负责自己的绘制、字体和资源实现。
