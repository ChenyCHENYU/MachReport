# MachReport 对标与实用化验收（2026-10-02）

## 对比边界

MachReport 是打印报表渲染引擎与 Vue 接入组件。`wl` 中《打印报表平台_运维操作手册》及 `wl-ui-produce/docs/打印报表平台接入指南.md` 描述的 jh4j-cloud-report 是包含目录、数据源、数据集、设计器、发布和迁移的打印报表平台。FineReport 11 的公开文档描述的是更完整的报表产品。三者的产品范围不同，比较时应先看具体业务流程，不能仅按功能数量或单项跑分判断替换能力。

| 业务环节 | MachReport | jh4j-cloud-report（wl 文档） | FineReport 11（公开文档） |
|---|---|---|---|
| 模板制作 | DSL/JSON；jh4j content 单向导入会降级 | 可视设计器、属性面板、Word/Excel 模板导入 | 普通报表与画布式决策报表设计 |
| 数据准备 | 本地数据集或消费已有 gridPlan；SQL 编译工具不提供数据库服务 | SQL/接口型数据集、多种数据库连接、参数登记 | 数据连接、数据集及权限管理 |
| 预览打印 | DOM/Canvas 预览、浏览器打印、前端 PDF | HTML 预览与以 PDF 为准的版式验收 | 预览、打印与多格式导出 |
| 上线运维 | 管理 API 客户端；未提供独立控制台 UI | 目录、发布、ZIP 跨环境迁移 | 模板版本管理、细粒度权限、定时调度 |

FineReport 依据：[决策报表设计](https://help.fanruan.com/finereport/edition-view-42228-46.html)、[数据连接权限](https://help.fanruan.com/finereport/doc-view-2457.html)、[导出方式](https://help.fanruan.com/finereport/edition-view-28247-58.html)、[模板版本管理](https://help.fanruan.com/finereport/doc-view-5276.html)、[模板内容权限](https://help.fanruan.com/finereport/doc-view-866.html)、[定时调度](https://help.fanruan.com/finereport/edition-view-44253-47.html)。这些资料证明能力存在，不代表针对本项目模板的保真或性能结论。

## 本轮落地

1. 修复内置 fetch 与 jh4j adapter 双重拼接 `baseUrl`；业务参数不能覆盖模板 ID；结构不完整的成功响应按错误处理。
2. 宿主更新 `params` 时同步参数面板；清空可选条件会真正移除旧查询值；页间距配置变化同步到虚拟窗口。
3. Vue 工具栏接通真实 XLSX 导出；未知格式报错；“PDF 窗口”加载 PDF 字节；PDF 缺字/渲染失败不下载残缺文件，非致命保真降级有可见提示。
4. 打印逐页渲染并写入 iframe，避免打印前为所有页面预建 DOM 字符串。
5. 修复真实 `gridPlan` 样本采集路径，使采集后契约测试真正启用；样本默认忽略提交，以免业务数据进入仓库。

## 尚需真实环境验收

当前工作区没有 `MR_SIT_BASE`，也没有真实 `gridPlan` 样本。文档中的内网报表平台地址从当前执行环境连接超时。`real-contract.test.ts` 的真实契约测试仍会跳过。这是环境验证边界，不应表述为“已完整替换 jh4j”。获得可访问的报表环境和登录后执行：

```powershell
$env:MR_SIT_BASE = "https://report.example.com"
pnpm.cmd capture:gridplan "第一张报表的tempId"
pnpm.cmd capture:gridplan "第二张报表的tempId"
pnpm.cmd exec vitest run packages/mach-report/src/__tests__/real-contract.test.ts --retry=0
```

每张样本保存为 `packages/mach-report/tests/fixtures/gridplan-real-<tempId>.json`，旧的 `gridplan-real.json` 也继续识别；样本默认忽略 Git 提交。请用经授权、已脱敏的单据采集。再选 3～5 张典型报表，逐张对照 jh4j PDF：长明细跨页、合并单元格、条码/图片、中文字体、混合纸张；检查预览、PDF、Excel 和打印。只有这一步通过后，才能对具体模板宣布可替换。

性能比较也应基于同一模板、同一数据、同一机器和同一网络分别测取数、分页、首屏、导出及峰值内存。现有 `perf-budget.test.ts` 是 MachReport 内部回归门槛，不能证明相对 jh4j 或 FineReport 的速度优势。

## 暂不扩展的范围

现阶段继续使用 jh4j 平台管理数据源、模板发布和跨环境迁移。独立设计器、填报、驾驶舱、调度及细粒度权限只有在明确脱离平台的业务场景出现时再立项。这样能先把打印单据的正确性和接入体验做稳。
