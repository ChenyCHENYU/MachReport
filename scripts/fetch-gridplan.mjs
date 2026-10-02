import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

/**
 * 真实 gridPlan 抓取工具（需人工登录一次）
 *
 * 用法（环境地址从环境变量读取，勿硬编码内网地址）：
 *   MR_SIT_BASE=https://<sit-host> node scripts/fetch-gridplan.mjs <tempId> [furnitureTempId]
 *
 * 流程：打开报表平台 → 人工完成登录 → 脚本检测到登录态后自动用页面身份
 *       调 /report/codePrintReport/gridPlan → 存 packages/mach-report/tests/fixtures/gridplan-real-<tempId>.json
 */
const BASE = process.env.MR_SIT_BASE?.replace(/\/+$/, "");
if (!BASE) {
  console.error("[gridplan] 缺少 MR_SIT_BASE 环境变量（报表平台地址）");
  process.exit(1);
}
const TEMP_ID = process.argv[2];
if (!TEMP_ID || !/^[a-zA-Z0-9_-]+$/.test(TEMP_ID)) {
  console.error("[gridplan] 请传入已发布的 tempId（仅字母、数字、下划线或连字符）");
  process.exit(1);
}
const FURNITURE = process.argv[3] ?? "";
const OUT = path.resolve(process.cwd(), `packages/mach-report/tests/fixtures/gridplan-real-${TEMP_ID}.json`);

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });

if (/login|oauth/i.test(page.url())) {
  console.log("[gridplan] 请在浏览器中完成登录（最长等待 4 分钟）...");
  await page
    .waitForURL((url) => !/login|oauth/i.test(url.toString()), { timeout: 4 * 60_000 })
    .catch(() => {
      console.error("[gridplan] 登录超时，退出。");
      process.exit(1);
    });
}
console.log("[gridplan] 检测到登录态，开始调用 gridPlan ...");

const query = new URLSearchParams({ tempId: TEMP_ID });
if (FURNITURE) query.set("furnitureTempId", FURNITURE);
const url = `${BASE}/report/codePrintReport/gridPlan?${query.toString()}`;

const payload = await page.evaluate(async (target) => {
  const res = await fetch(target, { credentials: "include" });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: null, raw: text.slice(0, 500) };
  }
}, url);

const pages = payload.body?.data?.pages;
if (payload.status !== 200 || payload.body?.code !== 200 || !Array.isArray(pages)) {
  console.error("[gridplan] 响应不符合 gridPlan 契约：", {
    status: payload.status,
    code: payload.body?.code,
    message: payload.body?.message,
    pages: Array.isArray(pages) ? pages.length : "N/A"
  });
  await browser.close();
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload.body, null, 1), "utf-8");
console.log(
  `[gridplan] 已保存 ${OUT}\n  HTTP ${payload.status} code=${payload.body?.code} pages=${Array.isArray(pages) ? pages.length : "N/A"}`
);
await browser.close();
