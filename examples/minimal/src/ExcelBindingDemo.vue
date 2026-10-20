<script setup lang="ts">
import { computed, ref } from "vue";
import {
  ExcelBindingWizard,
  type ExcelBindingWizardApply,
} from "@agile-team/mach-report/designer";
import { ReportPreview } from "@agile-team/mach-report/vue";
import { createLocalFetcher } from "@agile-team/mach-report/vue";
import type {
  ExcelBindingDataset,
  AnyExcelBindingSession,
} from "@agile-team/mach-report/xlsx";
const readonly = ref(false);
const session = ref<AnyExcelBindingSession>();
const result = ref<ExcelBindingWizardApply>();
const datasets: ExcelBindingDataset[] = [
  {
    id: "production",
    label: "生产实绩 · 示例契约",
    fields: [
      {
        field: "heat",
        label: "炉号",
        type: "text",
        semanticRole: "identifier",
        sample: "000418",
      },
      {
        field: "weight",
        label: "产重",
        type: "number",
        unit: "kg",
        digits: 3,
        sample: 0,
      },
      {
        field: "energy",
        label: "用电量",
        type: "number",
        unit: "kWh",
        digits: 2,
        sample: 30800,
      },
    ],
    rowKey: "heat",
    samples: [{ heat: "000418", weight: 0, energy: 30800 }],
  },
];
datasets.push({ ...datasets[0]!, id: "summary", label: "产量概览 · 单记录示例", samples: [{ heat: "SUMMARY-01", weight: 0, energy: 30800 }] });
const fetcher = computed(() =>
  result.value
    ? createLocalFetcher({
        bound: {
          template: result.value.document.template,
          datasets: {
            summary: [{ heat: "SUMMARY-01", weight: 0, energy: 30800 }],
            production: [
              { heat: "LIVE-001", weight: 0, energy: 30800 },
              { heat: "LIVE-002", weight: 64200.125, energy: 29600 },
            ],
          },
        },
      })
    : undefined,
);
function apply(value: ExcelBindingWizardApply): void {
  result.value = value;
}
function reopen(): void {
  if (result.value)
    session.value = JSON.parse(
      JSON.stringify(result.value.session),
    ) as AnyExcelBindingSession;
}
</script>
<template>
  <main class="binding-demo">
    <header>
      <div>
        <small>MACHREPORT / EXCEL BINDING</small>
        <h1>从 Excel 模板，到可重复取数的报表</h1>
        <p>隔离示例：上传文件与字段契约，显式绑定后预览；不会请求业务接口。</p>
      </div>
      <a href="/designer.html">返回设计器 ↗</a><label><input v-model="readonly" type="checkbox" />只读模式</label><button type="button" :disabled="!result" @click="reopen">
        恢复已保存绑定
      </button>
    </header>
    <ExcelBindingWizard
      :datasets="datasets"
      :session="session"
      :readonly="readonly"
      @apply="apply"
    />
    <section v-if="result" class="binding-result">
      <h2>
        业务模板预览 <span>隔离接口样例 · {{ result.document.id }}</span>
      </h2>
      <ReportPreview
        v-if="fetcher"
        report-id="bound"
        :fetcher="fetcher"
        :show-params="false"
        :show-export="false"
        height="450px"
      />
    </section>
  </main>
</template>
<style>
html,
body,
#app {
  margin: 0;
  min-height: 100%;
  font-family: system-ui, "Microsoft YaHei", sans-serif;
}
body {
  background: #f4f7fb;
  color: #334155;
}
.binding-demo {
  padding: 20px;
  max-width: 1680px;
  margin: auto;
}
.binding-demo > header {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 16px;
}
.binding-demo > header > div {
  flex: 1;
}
.binding-demo small {
  font-size: 10px;
  letter-spacing: 1.8px;
  color: #7f96b5;
}
.binding-demo h1 {
  font-size: 20px;
  margin: 5px 0;
}
.binding-demo p,
.binding-demo a,
.binding-demo > header label {
  font-size: 11px;
  color: #8191a7;
  margin: 0;
}
.binding-demo a {
  text-decoration: none;
}
.binding-demo > header button {
  font: 11px system-ui;
  height: 29px;
  border: 1px solid #dae3ef;
  border-radius: 5px;
  background: #fff;
  color: #587496;
}
.binding-demo > .mr-binding {
  height: calc(100vh - 132px);
  border: 1px solid #e6eaf0;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 8px 28px #19375506;
}
.binding-result {
  background: white;
  border: 1px solid #e6eaf0;
  border-radius: 8px;
  margin-top: 16px;
  padding: 12px;
}
.binding-result h2 {
  font-size: 13px;
  margin: 0 0 12px;
}
.binding-result h2 span {
  font-size: 11px;
  font-weight: 400;
  color: #8c9caf;
  margin-left: 10px;
}
</style>
