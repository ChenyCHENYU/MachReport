<script setup lang="ts">
import { ref } from "vue";
import { ReportPreview, createReportSource, createTableTemplate, provideMachReportConfig, type ReportParamOptionsLoader, type ReportRegistry } from "@agile-team/mach-report/vue";

const selected = ref<Readonly<Record<string, string>>>({});
const template = createTableTemplate({
  title: "Production query", columns: [{ field: "plant", header: "Plant" }, { field: "area", header: "Area" }, { field: "station", header: "Station" }, { field: "qty", header: "Quantity", semanticRole: "measure" }],
  params: [
    { field: "plant", label: "厂别", type: "select", required: true, defaultValue: "A", options: [{ value: "A", label: "一厂" }, { value: "B", label: "二厂" }] },
    { field: "area", label: "区域", type: "select", required: true, optionsSource: "production.areas", dependsOn: ["plant"], placeholder: "搜索炼钢或连铸" },
    { field: "station", label: "工位", type: "select", optionsSource: "production.stations", dependsOn: ["area"], placeholder: "搜索工位名称" },
  ]
});
const reports: ReportRegistry = { production: { template, load: ({ params }) => {
  selected.value = { ...params };
  return { detail: [{ plant: params.plant, area: params.area, station: params.station ?? "", qty: 0 }] };
} } };

const fetcher = createReportSource(reports);
provideMachReportConfig({ theme: { toolbarBg: "#ffffff", toolbarFg: "#334155", toolbarBorder: "#e2e8f0", shellBg: "#f1f5f9", btnFg: "#334155", btnBorder: "#cbd5e1", btnActiveBg: "#2563eb" } });

/** Local sample source. Real projects supply one trusted API adapter in this same place. */
const loadParamOptions: ReportParamOptionsLoader = ({ source, params, query, limit, signal }) => new Promise((resolve, reject) => {
  const parent = params.plant ?? params.area;
  const candidates = source === "production.areas"
    ? [{ value: `${parent}-EAF`, label: `${parent === "A" ? "一厂" : "二厂"} · 炼钢区域` }, { value: `${parent}-CC`, label: `${parent === "A" ? "一厂" : "二厂"} · 连铸区域` }]
    : [{ value: `${parent}-01`, label: "一号工位" }, { value: `${parent}-02`, label: "二号工位" }];
  const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", abort);
    resolve(candidates.filter(option => `${option.label} ${option.value}`.toLowerCase().includes(query.toLowerCase())).slice(0, limit));
  }, query === "炼" ? 900 : 240);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
});
</script>
<template>
  <main class="product-shell parameters-demo">
    <header class="product-heading">
      <a class="product-brand" href="/" aria-label="MachReport 首页">M<span>R</span></a>
      <div class="product-title"><p>MACHREPORT / QUERY EXPERIENCE</p><h1>搜索即定位，联动有边界</h1><p>一个选项加载函数，统一驱动参数表单</p></div>
      <a class="designer-link" href="/designer.html">在设计器中配置参数 ↗</a>
    </header>
    <section class="product-context"><div class="product-local"><span class="local-dot" />本地延迟选项源 <small>240ms 延迟 · 不连接业务数据库</small></div><p>选择厂别后搜索区域、工位。切换上级会清空下级，输入文字需选择后才成为查询值。方向键定位，Enter 选择，Esc 收起；中文输入法确认不会误选。</p></section>
    <ReportPreview report-id="production" :fetcher="fetcher" :load-param-options="loadParamOptions" :show-export="false" :show-pdf-window="false" :show-print="false" height="620px" />
    <footer class="product-footer" aria-label="已查询参数"><strong>实际查询快照</strong><code>{{ Object.keys(selected).length ? JSON.stringify(selected) : '选择区域后查询' }}</code></footer>
  </main>
</template>
<style scoped>
.parameters-demo .product-footer{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.parameters-demo code{font-size:12px;overflow-wrap:anywhere}.parameters-demo strong{font-size:12px;color:#385473}
</style>
