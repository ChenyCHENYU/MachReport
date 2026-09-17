import { createApp, h, provide, ref } from "vue";
import type { Component } from "vue";
import {
  __federation_method_setRemote as setRemote,
  __federation_method_getRemote as getRemote
} from "virtual:__federation__";
import { createLocalFetcher, MACH_REPORT_FETCHER_KEY } from "@mach-report/vue";
import { createTemplate } from "@mach-report/core";

/**
 * 宿主动态加载远程组件 —— 与 wl-ui-produce util/system.ts 相同机制：
 * virtual:__federation__ 的 setRemote(运行时注册) → getRemote(拉 expose)。
 * remoteEntry 来自 mock-gateway /sub/mach-report/assets/remoteEntry.js（构建产物）。
 */

const status = ref("加载远程组件中…");

const template = createTemplate()
  .page(210, 297, { marginTopMm: 12 })
  .text(
    "联邦宿主渲染验证",
    { leftMm: 45, topMm: 3, widthMm: 120, heightMm: 12 },
    { fontSize: 16, bold: true, align: "center" }
  )
  .list(
    "detail",
    { leftMm: 12, topMm: 20, widthMm: 186 },
    [
      { header: "序号", field: "no", widthMm: 30 },
      { header: "物料", field: "name", widthMm: 120 },
      { header: "数量", field: "qty", widthMm: 36 }
    ],
    { fontSizePt: 10 }
  )
  .build();

const datasets = {
  detail: Array.from({ length: 60 }, (_, i) => ({
    no: String(i + 1),
    name: `联邦物料-${i + 1}`,
    qty: String((i + 1) * 2)
  }))
};

const fetcher = createLocalFetcher({
  FED1: { tempId: "FED1", template, datasets }
});

async function bootstrap(): Promise<void> {
  try {
    setRemote("mach-report", {
      url: "/sub/mach-report/assets/remoteEntry.js",
      format: "esm",
      from: "vite"
    });
    const RemoteReportPreview = (await getRemote(
      "mach-report",
      "./mach-report/reportPreview"
    )) as Component;
    status.value = "远程组件加载成功";

    const app = createApp({
      setup() {
        provide(MACH_REPORT_FETCHER_KEY, fetcher);
        return () =>
          h("div", { style: "height:100vh" }, [
            h(RemoteReportPreview as never, {
              tempId: "FED1",
              height: "100vh",
              onLoaded: () => {
                status.value = "远程渲染完成";
              }
            })
          ]);
      }
    });
    app.mount("#app");
  } catch (e) {
    status.value = `加载失败：${e instanceof Error ? e.message : String(e)}`;
  }
}

void bootstrap();

const statusEl = document.getElementById("status");
if (statusEl) {
  setInterval(() => {
    statusEl.textContent = status.value;
  }, 200);
}
