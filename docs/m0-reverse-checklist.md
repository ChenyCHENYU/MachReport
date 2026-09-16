# MachReport 逆向侦察清单（M0 执行项）

> 目标：在写第一行引擎代码之前，把 jh4j-cloud-report 的私有协议全部变成类型定义。
> 来源：SIT 构建产物（未压缩、可读）+ 平台操作实测 + 导出包分析。

## 1. 需要拉取分析的产物

- [ ] SIT `/sub/jh4j-cloud-report/assets/` 全量 chunk 清单（按 remoteEntry moduleMap 索引）
- [ ] 重点 chunk：`src-report-grid-renderer.*`（渲染器核心，含 pages 数据结构消费方式）
- [ ] 重点 chunk：`api-download.*` / `src-api-response.*`（接口出入参类型）
- [ ] 设计器入口 `designer.*`（组件属性模型、保存的模板 JSON 形状）
- [ ] `reportList.*`（列表/发布/导入导出调用面）

## 2. 需要实测采集的样本

- [ ] gridPlan 接口返回体（拿一个已发布模板 + 参数实测，存 fixture）
- [ ] 报表导出 ZIP：解包结构（模板定义/数据集/参数/数据源文件的格式与命名）
- [ ] PDF 预览接口响应头（渲染引擎指纹：确认后端用什么渲染）
- [ ] 设计器保存动作的请求体（模板 JSON 完整 schema，含版心/组件/表达式）
- [ ] 数据源类型枚举与连接属性全集（MySQL/Oracle/SQLServer/达梦/openGauss 及 connMode/metaSchema）

## 3. 需要确认的契约细节

- [ ] 多模板拼接（tempId 逗号串）时 furniture-temp-id 的继承规则
- [ ] 系统变量全集（页码/总页数/当前日期/$params.*）
- [ ] 公式函数清单（求和/判空/格式化/去重 + 未知项）
- [ ] `{if}` 动态 SQL 的完整文法（转义规则 `\{`、字符串引号规则）
- [ ] 数据集"未被版面引用则跳过渲染"的判定方式（前端还是后端裁剪）
- [ ] 条码/二维码组件的前端生成 or 后端图片（影响扫码兼容策略）

## 4. 产出物

- `docs/reverse/grid-plan-schema.ts` — gridPlan 返回体 TS 类型
- `docs/reverse/template-schema.ts` — 模板 JSON TS 类型（草案，随实测迭代）
- `docs/reverse/export-zip-format.md` — 导出包结构
- `docs/reverse/api-surface.md` — 全部接口清单（路径/方法/出入参）
- `tests/fixtures/` — 真实返回样本（脱敏）
