# 发布包依赖与产物清单

每次构建自动生成并随 npm 包提供：

- `dist/sbom.cdx.json`：CycloneDX 1.6 格式，记录 PDF / XLSX / SQL / 编码可选库及其实际安装的运行依赖闭包、版本、入口归属、上游 package.json 摘要和锁文件摘要。
- `dist/licenses/`：上游许可证、NOTICE 等原文；上游发行包没有提供原文时保留其 package.json/README 证据，并在清单标记 `upstream-not-supplied`。
- `dist/artifact-integrity.json`：本次构建 JS/CJS/CSS 的 SHA-256，用于核对交付文件是否被替换。

上游有预打包的分发文件，因此清单采用保守的运行依赖闭包，不声称每个依赖的全部代码都进入每种输出。Vue 可选 peer 与公开 Node 类型保持外部依赖；不导入对应重入口时，核心包不会加载这些库。

`pnpm check:sbom` 核对版本、锁文件、许可证证据存在性和构建文件摘要。仓库中的 `THIRD_PARTY_NOTICES.md` 继续保留条码实现及内嵌字体的独立许可说明；自动清单不会替代这些资产说明。

当前上游发行物中 `buffers@0.1.1`、`chainsaw@0.1.0`、`saxes@5.0.1` 未附独立许可原文，清单明确列出。此处记录证据缺项，不将“有 SBOM”当作许可证授权或安全漏洞已审计的证明。替换或升级这些间接依赖需同时验证 Excel/压缩兼容性。

公开 API 另外由 `pnpm check:api` 比对13个入口的声明快照。增加或调整 API 后先检查升级影响，再执行 `pnpm check:api --update`，将可审查的签名差异一起提交；不能在 CI 自动更新基线掩盖变化。
