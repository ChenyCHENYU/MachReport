import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import federation from "@originjs/vite-plugin-federation";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import federation from "@originjs/vite-plugin-federation";

const FED_DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/federation/dist");

/**
 * 模拟 wl-ui-produce 宿主：
 * 1. 用同款 vite-plugin-federation 1.3.6（提供 __federation_method_setRemote 动态注册）
 * 2. /sub/mach-report/* 直接从 federation 包构建产物（dist）回源——模拟网关静态部署
 */
export default defineConfig({
  plugins: [
    vue(),
    federation({
      name: "fed-host",
      remotes: {
        stub: "/sub/stub/assets/remoteEntry.js"
      },
      shared: { vue: { singleton: true } }
    }),
    {
      name: "mock-gateway-sub",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url || !req.url.startsWith("/sub/mach-report/")) return next();
          const rel = req.url.slice("/sub/mach-report/".length).split("?")[0]!;
          const file = resolve(FED_DIST, rel);
          if (!file.startsWith(FED_DIST) || !existsSync(file)) {
            res.statusCode = 404;
            res.end("not found");
            return;
          }
          const ext = rel.endsWith(".js")
            ? "text/javascript"
            : rel.endsWith(".css")
              ? "text/css"
              : "application/octet-stream";
          res.setHeader("content-type", ext);
          res.end(readFileSync(file));
        });
      }
    }
  ],
  server: { port: 8611, strictPort: true }
});
