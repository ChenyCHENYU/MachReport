# MachReport 迭代进度日志

> 通宵自主执行模式 · 每个闭环 = 实现 → 测试 → 验证 → 检查点提交

## 检查点时间线

| # | 时间 | commit | 内容 | 验证 |
|---|---|---|---|---|
| 1 | 00:46 | e5061d6 | 脚手架 + core v0.1（schema/units/textwrap/paginate/DOM 渲染器） | 28 tests |
| 2 | 01:30 | a4cb69b | sql-engine v0.1（三语法编译 + 表达式求值 + 单 SELECT 校验） | 49 tests |
| 3 | 01:37 | (vue) | vue v0.1 契约组件 + jh4j/local 双适配器 | 59 tests |
| 4 | 01:45 | — | example 构建（gzip 34KB 含 Vue 运行时）、typecheck 收敛 | build ✓ |

## 验证基线（每个检查点必须全绿）

```
pnpm typecheck   # tsc -b 无错误
pnpm test        # 全部通过
example build    # vite build 成功
```

## 已完成能力清单

### core (@mach-report/core)
- [x] RenderPlan schema（对齐 jh4j gridPlan 逆向结构：pages/components/kind 枚举/mm 几何）
- [x] mm↔px↔pt 单位系统 + 纸张尺寸表
- [x] 近似文本测量（CJK/拉丁字符宽度模型）与折行
- [x] 模板 → RenderPlan 分页引擎：列表自动跨页、表头每页重复、行高自适应、列宽超宽缩放
- [x] DOM 渲染器：文本/富文本段落/预折行/图片类/形状/网格表格，样式类名可定制

### sql-engine (@mach-report/sql-engine)
- [x] `#{}`绑定 / `${}`文本替换 / `{if(cond,a,b)}` 动态条件（手册三范式全覆盖）
- [x] 表达式求值器：`isEmpty` `==` `!=` `+` 拼接、双引号字符串、嵌套花括号、`\{` 转义
- [x] 单 SELECT 结构校验：注释剥离、多语句拒绝、DML/DDL 关键字拒绝、SELECT INTO 拒绝
- [x] 缺参容错（NULL 绑定 + 告警数组，不抛错）

### vue (@mach-report/vue)
- [x] ReportPreview 契约组件：props/tempId(串/数组)/params/height/autoLoad/三显隐 与 jh4j 1:1
- [x] emits loaded(pageCount)/error(message)；expose reload/print/exportAs/openPdfWindow/gotoPage
- [x] 换单据先清空再渲染（根治闪旧内容）；打印走 iframe+srcdoc+@page 尺寸声明
- [x] jh4j gridPlan 适配器（request 可注入）+ 本地适配器（core 分页引擎直出）
- [x] 工具栏：翻页/适宽/100%/150%/导出/打印/PDF 窗口

## 夜间后续迭代队列

- [ ] core v0.2：视口页级虚拟化（离屏页高度锁定）+ 渲染基准测试（benchmark）
- [ ] Schema 校验器（RenderPlan 输入防坏数据）
- [ ] federation 入口包（expose 名对齐）
- [ ] eslint + prettier 接入
- [ ] PDF 直出调研（pdf-lib 矢量）
- [ ] M0 逆向遗留：designer chunk 模板 JSON 结构、导出 ZIP 格式
