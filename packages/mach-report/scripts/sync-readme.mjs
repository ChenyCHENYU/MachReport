import { copyFileSync } from "node:fs";
/** 发布前同步仓库根 README 到包目录（npm 包页与 GitHub 一致；产物已 gitignore） */
copyFileSync("../../README.md", "README.md");
console.log("README synced into package");
