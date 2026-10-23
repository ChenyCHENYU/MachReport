# 草稿恢复与版本冲突

`@agile-team/mach-report/designer` 将恢复、版本核对与未应用配置放在包内处理。宿主只选择存储位置，并提供已有模板服务的读取、保存和副本回调。

## 最小接入

```vue
<script setup lang="ts">
import { ref } from "vue";
import {
  ReportTemplateEditor,
  createTemplateDraftStorage,
  type TemplateEditorSaveContext,
  type TemplateConflictContext,
  type TemplateCopyContext,
} from "@agile-team/mach-report/designer";
import type { ReportTemplateDocument } from "@agile-team/mach-report";
import { initialDocument, templateApi, accountScope } from "./application";

const document = ref<ReportTemplateDocument>(initialDocument);
// 在浏览器 setup 中创建；SSR 在客户端挂载后设置此配置。
const draftStorage = {
  scope: accountScope, // 例如项目 ID + 当前账号 ID；不使用访问令牌。
  adapter: createTemplateDraftStorage(sessionStorage),
};
const save = (value: ReportTemplateDocument, context: TemplateEditorSaveContext) =>
  templateApi.save(value, context); // 服务端须原子校验 expectedRevision。
const loadLatest = ({ id, signal }: TemplateConflictContext) =>
  templateApi.read(id, { signal });
const keepCopy = (value: ReportTemplateDocument, context: TemplateCopyContext) =>
  templateApi.createCopy(value, context); // 服务端分配新 ID，不能更新原 ID。
</script>

<template>
  <ReportTemplateEditor
    v-model="document"
    :draft-storage="draftStorage"
    :save="save"
    :load-latest="loadLatest"
    :keep-copy="keepCopy"
  />
</template>
```

`templateApi` 是宿主现有接口的适配示意，插件不内置业务接口、鉴权或数据库。只需要恢复时可以仅传 `draftStorage`。保存回调的版本冲突错误应具有 `code: "conflict"`，其余网络或校验错误仍作为普通保存错误展示。

## 存储契约

```ts
interface TemplateDraftStorage {
  scope: string;
  adapter: {
    read(key: string, context: { signal: AbortSignal }):
      string | null | Promise<string | null>;
    write(key: string, value: string, context: { signal: AbortSignal }):
      void | Promise<void>;
    remove(key: string, context: { signal: AbortSignal }):
      void | Promise<void>;
  };
  debounceMs?: number; // 默认 400，允许 0–10000 毫秒。
  maxBytes?: number;   // 默认 2 MiB，允许 1 KiB–16 MiB，按 UTF-16 预算。
}
```

键由版本、`scope`、模板 ID 组成，并采用元组编码避免分隔符碰撞。记录保留完整共同基线及其修订号，因此读取远端新修订后仍能发现旧基线草稿。不会将修订号塞入一个无法再发现的独立键。

默认不启用存储。`createTemplateDraftStorage(sessionStorage)` 适合同一浏览器会话；显式选择 `localStorage` 才会跨浏览器会话保留。可以使用自有异步适配器，须遵守 `signal`，在取消后尽快停止工作。不要将凭据放入 scope；切换账号时应以账号身份作为编辑器的 Vue `key`，重新装配文档和存储配置。

读取期间以及发现草稿尚未作出选择时，编辑会暂时停用，避免当前输入与恢复提示互相覆盖。存储异常会显示提示，不阻断后续正常编辑；可以调用恢复区的放弃操作清理损坏记录。

## 恢复的内容

| 内容 | 行为 |
|---|---|
| 模板与共同基线 | 恢复名称、版面、字段及声明配置，保留原保存修订号 |
| 未应用 JSON | 保留原始字符串，包括尚未合法的输入；仍须显式应用 |
| 参数工具 | 保留未应用的参数行、控件类型、校验边界、选项和默认值 |
| 规则工具 | 保留计算表达式、分组、条件以及切换字段时缓存的未应用配置 |
| 明细、矩阵、树 | 保留各自未应用表单声明 |
| Excel 绑定 | 保留整表、多区域及各工作表映射配方；不保留文件或源网格 |
| 业务数据与预览 | 不存储 datasets、查询结果、计算预览值或 Workbook/File 对象 |
| 命名验收样例 | 不随自动草稿持久化；由宿主显式提供或在本次会话中管理 |

工具按需挂载时才装入已恢复配置。未应用配置仍计入草稿保护，必须在工具中应用或放弃后才能保存模板。Excel 恢复会明确要求重新选择原文件：同名工作表与映射校验通过后仍需人工核对，不会仅凭名字假定文件内容一致。

模板自身保存的静态文字、图片、网格和参数默认值属于模板声明，也会被存储。若这些内容包含敏感信息，请使用符合项目要求的存储适配器和清理策略；包不对业务内容作猜测性脱敏。

## 基线变化与冲突

1. 草稿基线与当前文档相同：选择“恢复草稿”或“放弃草稿”，不自动覆盖页面。
2. 基线不同：恢复后进入版本核对，展示共同基线到本地、共同基线到远端的两组差异；尚未处理时禁止保存。
3. 保存遇到 CAS 冲突：本地内容保持原样，调用 `loadLatest` 读取最新模板；可重新读取核对。
4. “采用最新版本”：经过现有未保存修改确认，完整切换到远端版本。
5. “保留本地内容，以最新版本为基线”：再次确认后保留完整本地内容，更新保存使用的修订号。此操作不合并远端改动；下一次保存仍由服务端 CAS 校验。
6. “保留独立副本”：调用 `keepCopy`，宿主生成新 ID；当前草稿、远端版本和冲突提示均保留，避免把保存副本误当作冲突已解决。

未提供 `loadLatest` 时，CAS 冲突仍保留本地内容，宿主可重新加载文档；旧基线恢复时已有当前文档可作为远端比较。未提供 `keepCopy` 时不显示副本动作。

## 生命周期与性能

写入防抖，完整记录只在实际写入时序列化；不在每次按键时重复序列化完整模板。每个适配器与键最多保留一个执行中的写操作和一个合并后的最新操作，避免慢存储造成无界队列。跨编辑器重挂载时，读取等待同键旧写入完成，旧请求不能在新请求之后覆盖数据；不同 scope 的键独立执行。

模板或 scope 变化取消旧读取，迟到回调不能改写当前 UI；卸载取消读取并保留已安排的最后写入。`pagehide` 会立即提交最后快照：浏览器同步 Storage 适配器可在该事件内完成，异步远端适配器在浏览器强制终止时不能保证最终网络请求完成，应提供自己的离线持久层。超出预算、损坏版本、错误身份或损坏工具声明均会被拒绝并明确提示。

模板成功保存或恢复到无修改状态后清理暂存记录。浏览器存储不提供跨设备协作和原子版本管理；正式模板仍须经过宿主保存服务的权限及 CAS 校验。
