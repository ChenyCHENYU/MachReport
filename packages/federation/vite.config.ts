import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import federation from "@originjs/vite-plugin-federation";

export default defineConfig({
  plugins: [
    vue(),
    federation({
      name: "mach-report",
      filename: "remoteEntry.js",
      exposes: {
        "./mach-report/reportPreview": "./src/reportPreview.vue",
        "./mach-report/reportHtmlPreview": "./src/reportHtmlPreview.vue",
        "./mach-report/filePreview": "./src/filePreview.vue"
      },
      shared: {
        vue: { singleton: true }
      }
    })
  ],
  build: {
    target: "es2022",
    cssCodeSplit: false,
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: "src/index.ts"
    }
  }
});
