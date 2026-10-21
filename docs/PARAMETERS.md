# 查询参数与可视化设计

参数定义保存在 `ReportTemplate.params` 中。预览自动生成表单，浏览器、Worker 与服务端复用核心参数校验；使用侧只传模板与取数函数，不再维护第二份表单和规则。

## 值契约

`params` 保持兼容的 `Record<string, string>`。日期不转为 JavaScript `Date`，不隐式转换时区，不补齐不完整日期。

| `type` | 接口值 | 控件与约束 |
| --- | --- | --- |
| `text` 或省略 | 文本字符串 | 支持 Unicode 字符数量 `minLength/maxLength` |
| `number` | 有限数字的字符串 | `min/max` 为有限数字；`typedValues` 中转换为数字 |
| `date` | `YYYY-MM-DD` | 严格有效日历日期；字符串边界 |
| `month` | `YYYY-MM` | 月份 `01` 至 `12`；同格式字符串边界 |
| `year` | `YYYY` | 四位年份 `0001` 至 `9999`；同格式字符串边界 |
| `dateRange` | `YYYY-MM-DD/YYYY-MM-DD` | 两端完整、真实且有序；`min/max` 为约束整个范围的单个日期 |
| `select` | `options[].value` | 静态字符串选项；标签和值分别配置 |

所有上下界均包含边界。日期范围允许开始和结束为同一天。可选参数可以完全清空；只填写范围的一端仍为无效值。数字以外的 `typedValues` 仍保持字符串，日期范围不会悄悄变成数组或对象。

```ts
import { createReportSource, type ReportParamDef } from '@agile-team/mach-report';

const params: ReportParamDef[] = [
  { field: 'month', label: '月份', type: 'month', required: true },
  { field: 'year', label: '年度', type: 'year', min: '2024', max: '2026' },
  {
    field: 'period', label: '统计期间', type: 'dateRange',
    min: '2026-01-01', max: '2026-12-31',
    defaultValue: '2026-10-01/2026-10-20',
  },
  {
    field: 'plant', label: '厂别', type: 'select', required: true,
    options: [{ label: '厂 A', value: 'A' }], defaultValue: 'A',
  },
];

const reports = {
  production: {
    template: { ...template, params },
    load: ({ params, signal }) => api.query(params, { signal }),
  },
};
const fetcher = createReportSource(reports);
```

`createReportSource` 在调用业务取数前合并默认值并校验。动态模板在加载模板后、业务取数前校验。非法定义、默认值、类型或范围不会通过空表伪装成功。

## 参数设计器

`ReportTemplateEditor` 的“工具 → 查询参数”直接提供参数目录、控件类型、显示名称、输入提示、默认值、必填、边界、文本长度和静态下拉选项。新增、排序和删除均在本地草稿中完成，只有“校验并应用参数”成功后才写入模板事务。

- 不完整表单不会修改已生效模板；无效参数不能应用。
- 参数草稿与 Excel 绑定、计算规则、JSON 一样参与离开和替换保护；未应用前不能保存模板。
- 恢复参数草稿只恢复该工具，不会清空其他模板属性。
- 改名、删除和新增会显示接口参数键变更，提醒同步核对接入方取数。
- 外部操作改变了模板参数时，保留未应用的本地内容并阻止覆盖；显式恢复后重新编辑。
- 应用通过已有模板事务写入，参与撤销、重做和模板版本保存，不直接访问后台。

参数目录为每项标记问题数量；即使当前参数没有错误，也能从顶部摘要看到其他参数的问题，并点击“定位首个问题”跳转、聚焦到对应控件。默认值、边界、长度和选项的错误就地展示，同时提供 `aria-invalid` 与错误说明关联，避免仅看到应用按钮禁用。

日期范围的默认值使用开始、结束两个日期输入框。只填一端或日期逆序时保留本地输入，切换参数后仍可继续填写，完成后才按既有字符串契约写入模板。年份使用整数输入，仍要求四位有效年份；数字默认值（包括 `0`）继续按字符串保存。关闭“设置默认值”会从生效定义中移除默认值；未应用前重新启用可继续编辑原输入。“接口值格式”按需展开，不占用主表单标题。

参数标识就是传给取数接口的键。插件无法检查宿主回调中的业务查询或后台 SQL，不会猜测或自动改写外部接口；发布前应使用真实参数样例检查查询和报表结果。静态选项不引入联动 HTTP、远程脚本或任意表达式执行。

## 前后端复用

核心校验没有 Vue、DOM 或数据连接依赖，可在服务端执行同一份参数定义。

```ts
import {
  validateReportParams,
  parseReportDateRange,
  formatReportDateRange,
  reportParamsJsonSchema,
} from '@agile-team/mach-report';

const checked = validateReportParams(definitions, request.params);
if (!checked.ok) {
  return { code: 'params', issues: checked.issues };
}

const range = checked.values.period
  ? parseReportDateRange(checked.values.period)
  : undefined;
// range 为 { start, end }；由受控 Provider 绑定实际业务查询。
const encoded = formatReportDateRange({ start: '2026-10-01', end: '2026-10-20' });
const schema = reportParamsJsonSchema(definitions);
```

`parseReportDateRange` 对无效范围返回 `undefined`；`formatReportDateRange` 对无效、缺端或逆序范围抛 `RangeError`。不要使用 `new Date()` 拆解日期参数，以免本地时区改变日期。

`validateReportParams` 返回结构化 `code/path/field/message`。`assertReportParams` 在失败时抛 `ReportParamValidationError`。未知参数继续保留以兼容既有取数契约；这不等于后台权限白名单，业务接口应自行约束允许的查询键。

JSON Schema 描述 `typedValues`，数字类型为 `number`，其余为 `string`。月份、年份和范围提供标准词法 `pattern`；真实日历、范围顺序和字符串边界通过 `x-report-date-range`、`x-report-minimum/maximum` 扩展表达。普通 JSON Schema 校验器不会自动执行这些扩展，应继续调用共享校验器或实现相同规则。模板发布样例检查也会执行这套参数校验。

## 边界

本能力负责声明、表单、默认值、严格值校验及可移植契约。动态业务默认日期、级联字典查询、数据库连接、账号权限、调度和机器人推送仍由平台服务负责；本轮不提供这些后台设施，也不执行任意脚本。
