<script setup lang="ts">
import { ref } from "vue";
import { parseReportTemplate } from "@agile-team/mach-report";
import { ReportLabelStudio } from "@agile-team/mach-report/designer";
import { provideMachReportConfig } from "@agile-team/mach-report/vue";
import { labelContract, labelDocument, labelRows } from "./label-template";
const document = ref(parseReportTemplate(labelDocument));
provideMachReportConfig({ defaults: { pdfFontUrl: "/fonts/mach-report-demo.otf", printOptions: { fonts: [{ family: "Microsoft YaHei", source: "/fonts/mach-report-demo.otf" }] } } });
</script>
<template>
  <main class="label-demo">
    <header class="label-heading">
      <a class="label-brand" href="/" aria-label="MR · MachReport 首页">M<span>R</span></a>
      <div><p>MACHREPORT / LABEL STUDIO</p><h1>材料标识工作台</h1><span>从字段到实物，让信息清晰可追溯</span></div>
      <a class="label-guide" href="https://github.com/ChenyCHENYU/MachReport/blob/main/docs/LABELS.md" target="_blank" rel="noreferrer">接入指南 <span aria-hidden="true">↗</span></a>
    </header>
    <div class="label-workspace"><ReportLabelStudio v-model="document" :rows="labelRows" :schema="labelContract" identity-field="serial" title="工业材料标签" /></div>
    <footer class="label-footer"><span>合成示例数据 · 当前会话保存 · 刷新恢复</span><span>毫米级布局 · 按需编码 · 可追溯输出</span></footer>
  </main>
</template>
<style src="./label-demo.css"></style>
