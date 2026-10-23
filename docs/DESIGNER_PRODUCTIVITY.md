# 复杂模板的结构、复用与验收

`ReportTemplateEditor` 把结构大纲、片段与样式、命名验收放在“工具”中按需展开。普通预览页无需引入设计器；结构和片段的数据操作也可以在 Node 中使用，不依赖 Vue。

## 最小接入

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { ReportTemplateEditor } from '@agile-team/mach-report/designer';
import type {
  ReportTemplateDocument,
  ReportTemplateFragment,
  ReportDocumentStyle,
  ReportTemplateFixture,
} from '@agile-team/mach-report';

const document = ref<ReportTemplateDocument>(loadedDocument);
const fragments: ReportTemplateFragment[] = sharedFragments;
const documentStyles: ReportDocumentStyle[] = [
  { id: 'heading', name: '品牌表头', target: 'header',
    style: { align: 'center', fontSize: 10, bold: true,
      color: '#21466e', backgroundColor: '#eaf2fb' } },
];
const reviewFixtures: ReportTemplateFixture[] = [
  { name: '正常与真实零值', datasets: { detail: [{ id: 'DEMO-01', qty: 0 }] } },
  { name: '空数据', datasets: { detail: [] } },
];
</script>

<template>
  <ReportTemplateEditor
    v-model="document"
    :datasets="deidentifiedPreviewData"
    :data-schemas="dataSchemas"
    :fragments="fragments"
    :document-styles="documentStyles"
    :review-fixtures="reviewFixtures"
    :save="saveDraft"
  />
</template>
```

`loadedDocument`、`sharedFragments`、`deidentifiedPreviewData`、`dataSchemas` 和 `saveDraft` 由宿主提供。已有页面只需按需追加三个可选 prop；不提供共享片段或样例，也能使用大纲、内置内容样式和当前会话捕获。

## 结构与依赖定位

打开“工具 → 结构大纲”，可以搜索版面、组件内容、业务字段、计算字段和绑定引用。点击组件或字段会进入相应版面并选中目标；点击版面会进入它的纸张属性。字段的“引用位置”同时包含显示列、公式、条件、分组、汇总、主从关系和标签绑定。

大纲先建立索引，再按 100 项窗口呈现，避免复杂模板一次挂载全部按钮。需要更多结果时点“显示更多”。它不会执行公式或加载业务数据。

修改某列的业务字段时，如果原字段还有其他引用，设计器会先展示影响位置。确认后**只改变当前列映射**，保留其他公式和业务引用；不会把一个字段的所有同名出现都盲目替换。取消则保留原映射。确认未处理时，保存和离开保护仍然生效。

如果宿主另有字段删除、全局改名界面，可先调用同一依赖 API，展示影响并让业务明确选择如何迁移：

```ts
import { collectTemplateOutline, inspectTemplateFieldUsage } from '@agile-team/mach-report';

const outline = collectTemplateOutline(document.template);
const affected = inspectTemplateFieldUsage(document.template, 'detail', 'qty');
// affected: dataset / field / kind / path / pageIndex / componentIndex
```

字符串公式只有显式声明的 `dependsOn` 能用于静态依赖分析；引擎不解析或执行任意脚本。参数定义及数据源字段的所有权仍在宿主，不提供隐式数据库字段迁移。

## 可复用片段

“工具 → 片段与样式”支持将当前选中组件保存为会话片段；共享片段通过 `fragments` 传入。插入前可重新绑定片段的数据集和源字段，计算结果字段名保持片段自身定义。

片段是带 `id / name / revision` 的普通 JSON，插入得到独立副本，组件上的旧 `nid / rkey / table / source` 等计划身份会清理。文档 ID、业务模板 CAS 修订及周围组件不变。共享库更新不会改写已经插入的模板，更不会修改已发布模板。

选择一个旧片段实例，再在共享片段库中选择相同 ID 的新修订，会出现“显式更新此片段”。更新只替换该实例，保留位置；其他实例仍保留原修订。更新前应检查字段重绑和新尺寸；越出目标纸张、记录数据集不匹配或引用到已不存在实例时会明确失败。

```ts
import {
  captureTemplateFragment,
  inspectTemplateFragmentBindings,
  insertTemplateFragment,
} from '@agile-team/mach-report';

// 多组件片段可用纯 API 捕获，例如一个品牌区的 Logo、文字和追溯码。
const fragment = captureTemplateFragment(document, 0, [0, 1, 2], {
  id: 'brand', name: '品牌与追溯区', revision: '1',
});
const requirements = inspectTemplateFragmentBindings(fragment);
const inserted = insertTemplateFragment(document, fragment, {
  pageIndex: 0, leftMm: 4, topMm: 4,
  bindings: {
    datasets: { originalRows: 'detail' },
    fields: { originalRows: { productCode: 'materialCode' } },
  },
});
// inserted.document 是新快照；原 document / fragment 不变。
// inserted.instance 用于下一次明确升级同一片段实例。
const upgraded = insertTemplateFragment(inserted.document, newRevision, {
  pageIndex: 0, replaceInstance: inserted.instance,
  bindings: revisedBindings,
});
```

片段适用于固定页面；Excel 区域流式布局由绑定向导管理，不能直接插入片段以破坏流式区域关系。列表片段检查静态首行和宽度，实际多行分页仍需用验收样例验证。共享库的存储、审核和授权由宿主实现；当前会话片段不自动上传。

## 报表内容样式

内置角色包括标题、表头、正文、数值和说明。选择组件后应用角色，或者复制当前样式，再选择另一个组件粘贴。对列表使用表头角色会同时更新合并表头和列的表头覆盖；正文或数值角色作用于正文列。

这些样式只改变报表内容，独立于预览与设计器的外壳 `theme`。角色按显式操作复制到模板；修改品牌角色库不会悄悄改变已有模板。

```ts
import { applyReportDocumentStyle } from '@agile-team/mach-report';
const next = applyReportDocumentStyle(document, 0, [2], {
  id: 'measure', name: '数值正文',
  style: { fontSize: 10, align: 'right', color: '#334155' },
});
```

## 命名验收与并排对照

“工具 → 发布检查”的“变更与验收”面板保留原有抽样模式，也可展开“命名验收样例”：

1. 给当前数据命名，例如“正常明细”“空数据”“超长名称”“跨页”“数值极值”。
2. 如果模板有参数定义，可填写该样例的可选参数。参数用于契约检查；样例提供的是显式数据，验收不会代发业务查询或 SQL。
3. 明确确认数据已经脱敏，再捕获到当前会话。捕获保留真实零值，拒绝 getter、循环、非 JSON 值和过量数据。
4. 运行检查，逐组查看行数、页数和问题；每组问题带样例名称，支持定位原模板组件。
5. 点“对比基线与草稿”，查看页数、页面尺寸和字段引用的变化，以及同一份样例数据的两个预览。

宿主传入 `reviewFixtures` 可固定团队常用场景。显式样例逐组完整检查，不使用上方“20/100 行”截断范围；每组总计不超过 1000 行，最多 20 组，名称唯一且不超过 120 字符。树形数据必须保留完整父子关系。

对照仅在打开后计算，每侧使用有界分页并复用同一份已生成计划，不重复取数，也不做昂贵的整页像素比较。输入、范围或模板变动后，旧绿色结果和旧对照会失效，必须重新检查。

设计器的验收过程按样例让出主线程，提供进度与“取消检查”。结构、基线和字段检查之间也会让出执行机会；输入变化或卸载会取消旧任务，旧任务不能覆盖新结果。取消不会返回部分通过结论。每个单独阶段仍是有预算的同步计算，大规模生产任务可使用已有 Worker/Node 执行器。

浏览器和 Node 均可直接使用同一异步预检入口；同步 `reviewReportTemplate` 保持兼容：

```ts
import { reviewReportTemplateAsync } from '@agile-team/mach-report';

const controller = new AbortController();
const result = await reviewReportTemplateAsync(document, {
  previous: publishedDocument,
  dataSchemas,
  fixtures: reviewFixtures,
  signal: controller.signal,
  onProgress: ({ stage, completed, total, fixture }) => {
    // 只更新状态；观察者异常不会改变预检结果。
  },
});
```

主模板在第一次让出执行前建立独立快照。调用方须在任务完成前保持样例、字段契约和基线对象稳定；需要变更时先取消旧任务再调用。`signal` 已取消时不会解析输入；阶段之间取消会拒绝 Promise，而不是返回部分绿色结果。设计器会替宿主处理这些失效和取消细节。

样例数据只留在会话中，不写入模板 JSON、草稿恢复存储或共享片段。它们也不会被自动脱敏；业务数据是否可用由宿主和操作人明确判断。预检不代替服务端真实编码、字体资源检查、发布授权和全量数据校验。
