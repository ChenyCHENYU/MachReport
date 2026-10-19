<script setup lang="ts">
import { ref } from "vue";
import {
  columnsFromContract,
  createMemoryTemplateStore,
  createTableTemplate,
  createTemplateManager,
  defineReportTemplate,
  type DatasetContract,
  type ReportTemplateDocument,
} from "@agile-team/mach-report";
import {
  ReportTemplateEditor,
  type TemplateEditorSaveContext,
} from "@agile-team/mach-report/designer";

const contract: DatasetContract = {
  rowKey: "heat",
  fields: [
    { field: "heat", label: "炉号", type: "text", semanticRole: "identifier" },
    { field: "grade", label: "钢种", type: "text", semanticRole: "dimension" },
    { field: "shift", label: "班别", type: "text", semanticRole: "dimension" },
    {
      field: "weight",
      label: "钢水重量",
      unit: "kg",
      type: "number",
      semanticRole: "measure",
    },
    {
      field: "energy",
      label: "总用电量",
      unit: "kWh",
      type: "number",
      semanticRole: "measure",
    },
  ],
};
const document = ref(
  defineReportTemplate({
    id: "eaf-demo",
    name: "电炉日报 · 模板示例",
    template: createTableTemplate({
      title: "电炉日报",
      layout: "wide",
      columns: columnsFromContract(contract),
      listOptions: { rowKey: "heat" },
    }),
  }),
);
const datasets = {
  detail: [
    {
      heat: "000418",
      grade: "S316LS",
      shift: "白班",
      weight: 64200,
      energy: 30800,
    },
    {
      heat: "000419",
      grade: "S304LX",
      shift: "白班",
      weight: 63850,
      energy: 29600,
    },
    { heat: "000420", grade: "S316LS", shift: "夜班", weight: 0, energy: 0 },
  ],
};
const manager = createTemplateManager(createMemoryTemplateStore());
const status = ref("示例数据 · 内存适配器，刷新后清空");
async function save(
  draft: ReportTemplateDocument,
  context: TemplateEditorSaveContext,
): Promise<ReportTemplateDocument> {
  const record = await manager.saveDraft(draft, {
    expectedRevision: context.expectedRevision ?? null,
    signal: context.signal,
  });
  status.value = `草稿已保存 · 修订 ${record.revision}`;
  return record.draft!;
}
</script>

<template>
  <main class="workbench">
    <header class="workbench-heading">
      <div class="brand">M<span>R</span></div>
      <div>
        <p>MACHREPORT / TEMPLATE WORKBENCH</p>
        <h1>让业务模板，成为可维护的报表</h1>
        <span>在画布设计、绑定
          Excel、配置计算与检查发布之间流畅切换。保存通过统一模板管理契约。</span>
      </div>
      <a href="/">返回预览示例 ↗</a>
    </header>
    <div class="workbench-status">
      <span>● 可视化设计器</span><span aria-live="polite">{{ status }}</span>
    </div>
    <ReportTemplateEditor
      v-model="document"
      :datasets="datasets"
      :data-schemas="{ detail: contract }"
      :binding-datasets="[
        {
          id: 'detail',
          label: '炼钢实绩',
          fields: contract.fields.map((field) => ({
            ...field,
            sample:
              datasets.detail[0]?.[
                field.field as keyof (typeof datasets.detail)[0]
              ],
          })),
        },
      ]"
      :save="save"
    />
  </main>
</template>

<style>
html,
body,
#app {
  margin: 0;
  min-height: 100%;
  font-family: "Microsoft YaHei", system-ui, sans-serif;
}
body {
  background: #f1f5f9;
  color: #1e293b;
}
.workbench {
  max-width: 1600px;
  margin: auto;
  padding: 28px;
}
.workbench-heading {
  display: flex;
  gap: 18px;
  align-items: center;
  margin-bottom: 24px;
}
.brand {
  display: grid;
  place-content: center;
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  border-radius: 15px;
  background: #163657;
  color: white;
  font-size: 20px;
  font-weight: 800;
}
.brand span {
  color: #72d8c7;
}
.workbench-heading p {
  margin: 0;
  font: 10px/1.5 system-ui;
  letter-spacing: 2px;
  color: #64748b;
}
.workbench-heading h1 {
  font-size: 24px;
  margin: 4px 0 8px;
}
.workbench-heading span {
  color: #64748b;
  font-size: 12px;
}
.workbench-heading a {
  margin-left: auto;
  color: #245485;
  text-decoration: none;
  white-space: nowrap;
  font-size: 12px;
}
.workbench-status {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 0 2px 10px;
  font-size: 11px;
  color: #64748b;
}
.workbench-status span:first-child {
  color: #14806b;
}
.workbench > .mr-designer {
  height: calc(100vh - 205px);
  min-height: 520px;
  box-shadow: 0 14px 38px #1432520a;
}
@media (max-width: 720px) {
  .workbench {
    padding: 12px;
  }
  .workbench-heading {
    gap: 10px;
    flex-wrap: wrap;
  }
  .workbench-heading h1 {
    font-size: 18px;
  }
  .workbench-heading a {
    margin-left: 0;
  }
  .workbench-status {
    flex-wrap: wrap;
  }
  .workbench > .mr-designer {
    height: 850px;
  }
}
</style>
