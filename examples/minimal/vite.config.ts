import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: { rollupOptions: { input: { main: "index.html", designer: "designer.html", product: "product.html", excelBinding: "excel-binding.html", platform: "platform.html", labels: "labels.html", parameters: "parameters.html", dataTools: "data-tools.html" } } },
  server: { port: 8610, strictPort: true }
});
