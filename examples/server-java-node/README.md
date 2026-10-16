# Java → Node 报表参考服务

此例使用 Node HTTP 标准库与 Java 17+ `HttpClient`，没有 Express、Spring 或 JSON 客户端依赖。Java 负责项目认证、业务口径与调用，Node 复用 MachReport 的参数校验、排版和文件输出。

在仓库根目录构建后运行完整验证：

```bash
pnpm --filter @agile-team/mach-report build
node scripts/check-server-example.mjs
```

脚本将实际 npm 打包产物解压到临时消费目录，启动仅监听 `127.0.0.1` 的临时服务，执行 `javac --release 17` 与 Java 客户端，再关闭服务并清理临时文件。需本机 Node、pnpm、JDK 17+；它会真实验证：

- 取数与排版，业务修订及关联请求 ID。
- 前导零标识与高精度十进制字符串，Java `BigDecimal` 不经 `double`。
- 无效日期返回 HTTP 422 + `error.code=params`，服务端超时返回 504 + `timeout`。
- 客户端超时断开后，服务器取消取数及任务，活动/排队槽位归零。
- PDF/XLSX 的二进制头、文件名、修订响应头与实际文件下载。
- 24 次分批并发查询和 8 次并发导出；记录服务端堆样本，槽位释放作为确定性门禁，不以 GC 时间差制造不稳定阈值。

## 独立使用

把 `server.mjs`、`ReportClient.java` 和 `fixtures/` 复制到一个新目录，安装发布包后运行：

```bash
npm init -y
npm install @agile-team/mach-report
node server.mjs
```

另一个终端编译、调用：

```bash
javac --release 17 ReportClient.java
java ReportClient http://127.0.0.1:8620 ./fixtures ./downloads
```

服务接口：

| 请求 | 用途 |
| --- | --- |
| `GET /reports` | 参数 JSON Schema、数据契约及能力描述 |
| `POST /reports/sample/prepare` | JSON RenderPlan、诊断、统计、修订 |
| `POST /reports/sample/export/pdf` | PDF 二进制下载 |
| `POST /reports/sample/export/xlsx` | Excel 二进制下载 |
| `GET /health` | 本机验证用任务计数和堆样本 |

`X-Request-Id` 限制为 1–80 位字母、数字、点、横线和下划线，不合法时由服务生成 ID。错误体保留 `code/message/correlationId`，校验错误附 `issues`，预算错误附 `path`。请求体限制 16 KiB，参数通过白名单。

此例固定数据是可重复运行的契约 fixture。实际项目替换 `provider.query`，将请求取消信号传入数据库驱动或上游 HTTP 请求，并在路由前接自己的认证、授权；不要直接公开示例的健康诊断端点。PDF 中文字体通过 Runtime 配置显式提供。同步 CPU 任务需要硬取消时按 [服务端文档](../../docs/SERVER.md) 接入 Node Worker。
