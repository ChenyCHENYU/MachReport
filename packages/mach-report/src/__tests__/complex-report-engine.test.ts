// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  computeDataset,
  getComputationMetadata,
  validateComputedFields,
} from "../analytics/computed";
import { aggregateRows } from "../analytics/aggregate";
import {
  formatDecimal,
  parseDecimal,
  printDecimal,
  divideDecimal,
} from "../analytics/decimal";
import { createMatrixTable } from "../analytics/matrix";
import {
  countTemplatePages,
  estimateListLayoutCells,
  paginateTemplate,
  paginateTemplatePages,
  type ListComponent,
  type ReportTemplate,
} from "../layout/paginate";
import { projectListColumns } from "../layout/list-projection";
import { validateReportTemplate } from "../source/template-registry";
import { heuristicMeasurer } from "../layout/textwrap";
import { formatValue, evalStyleRule } from "../format";
function list(extra: Partial<ListComponent> = {}): ListComponent {
  return {
    kind: "list",
    id: "main",
    dataset: "rows",
    leftMm: 5,
    topMm: 5,
    widthMm: 90,
    rowHeightMm: 6,
    columns: [
      { header: "Name", field: "id", widthMm: 30 },
      { header: "Value", field: "value", widthMm: 30 },
      { header: "Weight", field: "weight", widthMm: 30 },
    ],
    ...extra,
  };
}
function template(component = list(), height = 65): ReportTemplate {
  return {
    pages: [
      {
        widthMm: 100,
        heightMm: height,
        marginBottomMm: 5,
        components: [component],
      },
    ],
  };
}
const rows = [
  { id: "1", plant: "A", shift: "day", value: 0, weight: 1 },
  { id: "2", plant: "A", shift: "night", value: 10, weight: 3 },
  { id: "3", plant: "B", shift: "day", value: 20, weight: 2 },
];
const flat = (value: ReturnType<typeof paginateTemplate>) =>
  value.plan.pages.flatMap((page) => page.components);
describe("bounded decimal and scoped computation", () => {
  it("large decimal arithmetic and formatting never converts text to double", () => {
    const result = computeDataset([{ a: "9007199254740993.01", b: "0.09" }], {
      fields: [
        {
          field: "total",
          numeric: "decimal",
          expression: { op: "add", args: [{ field: "a" }, { field: "b" }] },
        },
      ],
    });
    expect(result.rows[0]!.total).toBe("9007199254740993.1");
    expect(
      formatValue(result.rows[0]!.total, {
        kind: "number",
        digits: 2,
        thousands: true,
      }),
    ).toBe("9,007,199,254,740,993.10");
    expect(formatDecimal("0.12345", 3, false, true)).toBe("12.345%");
  });
  it("rounds ties away from zero and handles negative zero", () => {
    expect(printDecimal(parseDecimal("-1.005"), 2)).toBe("-1.01");
    expect(printDecimal(parseDecimal("1.005"), 2)).toBe("1.01");
    expect(printDecimal(parseDecimal("-0.000"), 2)).toBe("0.00");
    expect(
      printDecimal(divideDecimal(parseDecimal("1"), parseDecimal("3"), 4)),
    ).toBe("0.3333");
  });
  it("rejects invalid decimal and budgets", () => {
    for (const value of [
      "",
      "Infinity",
      "1,000",
      true,
      "1e9999",
      "1".repeat(1001),
    ])
      expect(() => parseDecimal(value)).toThrow();
    expect(() => divideDecimal(parseDecimal("1"), parseDecimal("0"))).toThrow(
      /零/,
    );
    expect(() => printDecimal(parseDecimal("1"), 101)).toThrow(/0–100/);
  });
  it("sorts dependencies instead of requiring manual declaration order", () => {
    const fields = [
      {
        field: "twice",
        expression: {
          op: "multiply" as const,
          args: [{ field: "sum" }, { value: 2 }],
        },
      },
      {
        field: "sum",
        expression: {
          op: "add" as const,
          args: [{ field: "a" }, { value: 1 }],
        },
      },
    ];
    expect(validateComputedFields(fields).order).toEqual(["sum", "twice"]);
    expect(computeDataset([{ a: 2 }], { fields }).rows[0]).toEqual({
      a: 2,
      sum: 3,
      twice: 6,
    });
    expect(
      validateComputedFields([
        { field: "x", expression: { field: "y" } },
        { field: "y", expression: { field: "x" } },
      ]),
    ).toMatchObject({ valid: false });
  });
  it("row, group and dataset aggregate scopes share correct upstream values", () => {
    const result = computeDataset(rows, {
      fields: [
        {
          field: "ratio",
          scope: "group",
          groupBy: ["plant"],
          expression: {
            op: "divide",
            args: [{ field: "value" }, { aggregate: "sum", field: "value" }],
          },
        },
        {
          field: "all",
          scope: "dataset",
          expression: { aggregate: "avg", field: "value" },
        },
        { field: "single", expression: { aggregate: "count" } },
      ],
    });
    expect(result.rows.map((row) => row.ratio)).toEqual([0, 1, 1]);
    expect(result.rows.map((row) => row.all)).toEqual([10, 10, 10]);
    expect(result.rows.map((row) => row.single)).toEqual([1, 1, 1]);
  });
  it("aggregate dependencies are completed for all rows before dependent groups execute", () => {
    const result = computeDataset(rows, {
      fields: [
        {
          field: "sum",
          scope: "dataset",
          expression: { aggregate: "sum", field: "doubled" },
        },
        {
          field: "doubled",
          expression: {
            op: "multiply",
            args: [{ field: "value" }, { value: 2 }],
          },
        },
      ],
    });
    expect(result.rows.map((row) => row.sum)).toEqual([60, 60, 60]);
  });
  it("preserves null/zero and explicit divide-zero policy", () => {
    const expression = {
      op: "divide" as const,
      args: [{ field: "a" }, { field: "b" }],
    };
    const result = computeDataset(
      [
        { a: null, b: 1 },
        { a: 0, b: 2 },
        { a: 1, b: 0 },
      ],
      { fields: [{ field: "out", expression, divisionByZero: "null" }] },
    );
    expect(result.rows.map((row) => row.out)).toEqual([null, 0, null]);
    expect(getComputationMetadata().rules).toMatchObject({
      aggregateNulls: "skip",
      decimalOutput: "string",
    });
  });
  it("aggregates raw samples and decimal weights correctly", () => {
    expect(
      aggregateRows(rows, {
        op: "weightedAvg",
        field: "value",
        weightField: "weight",
      }),
    ).toBeCloseTo(70 / 6);
    expect(
      aggregateRows(
        [
          { n: "0.1", w: "1" },
          { n: "0.2", w: "2" },
        ],
        {
          op: "weightedAvg",
          field: "n",
          weightField: "w",
          numeric: "decimal",
          digits: 6,
        },
      ),
    ).toBe("0.166667");
    expect(aggregateRows([{ n: null }], { op: "sum", field: "n" })).toBeNull();
    expect(
      aggregateRows([{ n: null }, { n: 0 }], { op: "count", field: "n" }),
    ).toBe(1);
    expect(
      aggregateRows([{ n: 1, w: 0 }], {
        op: "weightedAvg",
        field: "n",
        weightField: "w",
      }),
    ).toBeNull();
    expect(() =>
      aggregateRows([{ n: 1, w: -1 }], {
        op: "weightedAvg",
        field: "n",
        weightField: "w",
      }),
    ).toThrow(/负/);
  });
  it("rejects malformed scope, primitive group values and cancellation", () => {
    expect(
      validateComputedFields([
        { field: "x", scope: "group", expression: { value: 1 } },
      ]).valid,
    ).toBe(false);
    const signal = AbortSignal.abort();
    expect(() => computeDataset([], { fields: [], signal })).toThrow(/取消/);
    expect(() =>
      computeDataset([{ group: {} }], {
        fields: [
          {
            field: "x",
            scope: "group",
            groupBy: ["group"],
            expression: { value: 1 },
          },
        ],
      }),
    ).toThrow(/标量/);
  });
});
describe("nested grouping, keyed details and projections", () => {
  it("emits nested group heads/footers and weighted aggregates", () => {
    const component = list({
      groups: [
        {
          field: "plant",
          headerTemplate: "Plant {value}",
          aggregates: [
            { field: "value", op: "weightedAvg", weightField: "weight" },
          ],
        },
        {
          field: "shift",
          headerTemplate: "Shift {value}",
          subtotal: ["value"],
        },
      ],
      grandTotal: { aggregates: [{ field: "value", op: "sum" }] },
    });
    const result = flat(paginateTemplate(template(component, 200), { rows }));
    expect(
      result
        .filter((item) => item.table?.role === "group-header")
        .map((item) => item.grid!.cells[0]![0]!.text),
    ).toEqual(["Plant A", "Shift day", "Shift night", "Plant B", "Shift day"]);
    const values = result
      .filter((item) => item.table?.role === "subtotal")
      .map((item) => item.grid!.cells[0]![1]!.value);
    expect(values).toEqual([0, 10, 7.5, 20, 20]);
    expect(result.at(-1)!.grid!.cells[0]![1]!.value).toBe(30);
  });
  it("does not orphan nested group headers at the bottom of a page", () => {
    const component = list({
      groups: [{ field: "plant" }, { field: "shift" }],
    });
    const result = paginateTemplate(template(component, 50), { rows });
    for (const page of result.plan.pages)
      expect(page.components.at(-1)!.table?.role).not.toBe("group-header");
  });
  it("repeats group headers only while their groups remain active", () => {
    const component = list({
      groups: [
        { field: "plant", repeatHeader: true, headerTemplate: "Plant {value}" },
      ],
    });
    const result = paginateTemplate(template(component, 50), {
      rows: Array.from({ length: 20 }, (_, n) => ({
        id: String(n),
        plant: "A",
        value: n,
      })),
    });
    expect(result.plan.pages.length).toBeGreaterThan(1);
    for (const page of result.plan.pages.slice(1))
      expect(page.components[1]!.grid!.cells[0]![0]!.text).toBe("Plant A");
  });
  it("keys child rows by business relation and preserves their own edit identities", () => {
    const component = list({
      rowKey: "id",
      detail: {
        dataset: "lines",
        parentKey: "id",
        foreignKey: "master",
        rowKey: "line",
        columns: [
          { header: "Line", field: "line", widthMm: 40 },
          { header: "Qty", field: "qty", widthMm: 50 },
        ],
      },
    });
    const result = flat(
      paginateTemplate(template(component, 200), {
        rows: rows.slice(0, 2),
        lines: [
          { line: "l2", master: "2", qty: 4 },
          { line: "l1", master: "1", qty: 3 },
        ],
      }),
    );
    const bodies = result.filter((item) => item.table?.role === "body");
    expect(bodies.map((item) => item.table!.source!.rowKey)).toEqual([
      "1",
      "l1",
      "2",
      "l2",
    ]);
    expect(bodies[1]!.table).toMatchObject({
      columnKeys: ["line", "qty"],
      source: { datasetId: "lines", rowKey: "l1" },
    });
    expect(() =>
      paginateTemplate(template(component), {
        rows,
        lines: [{ master: "unknown", line: "x" }],
      }),
    ).toThrow(/未关联/);
    expect(() =>
      paginateTemplate(template(component), {
        rows: [rows[0]!, rows[0]!],
        lines: [],
      }),
    ).toThrow(/重复/);
  });
  it("computes before layout and uses the same conditional values/styles for all output", () => {
    const component = list({
      computed: [
        {
          field: "computed",
          expression: { op: "add", args: [{ field: "value" }, { value: 1 }] },
        },
      ],
      rowVisibleWhen: { field: "id", op: "!=", value: "3" },
      columns: [
        {
          header: "Computed",
          field: "computed",
          widthMm: 90,
          visibleWhen: { field: "value", op: ">", value: 0 },
          rules: [
            {
              when: { field: "computed", op: ">", value: 10 },
              style: { color: "#ff0000" },
            },
          ],
        },
      ],
    });
    const bodies = flat(paginateTemplate(template(component), { rows })).filter(
      (item) => item.table?.role === "body",
    );
    expect(bodies.map((item) => item.grid!.cells[0]![0]!.text)).toEqual([
      "",
      "11",
    ]);
    expect(bodies[0]!.grid!.cells[0]![0]!.value).toBeNull();
    expect(bodies[1]!.grid!.cells[0]![0]!.style!.color).toBe("#ff0000");
  });
  it("projects hidden columns through merged header spans without corrupting row spans", () => {
    const component = list({
      columns: [
        { header: "a", field: "a", widthMm: 30 },
        { header: "b", field: "b", widthMm: 30, hidden: true },
        { header: "c", field: "c", widthMm: 30 },
      ],
      headerGrid: {
        cells: [
          [
            { text: "Merged", colSpan: 2 },
            { text: "C", rowSpan: 2 },
          ],
          [{ text: "A" }, { text: "B" }],
        ],
        rowHeightsMm: [6, 6],
      },
    });
    const projected = projectListColumns(component);
    expect(projected.columns.map((column) => column.field)).toEqual(["a", "c"]);
    expect(projected.headerGrid!.cells).toEqual([
      [
        { text: "Merged", colSpan: 1 },
        { text: "C", rowSpan: 2, colSpan: 1 },
      ],
      [{ text: "A", colSpan: 1 }],
    ]);
    expect(component.columns).toHaveLength(3);
    expect(() =>
      projectListColumns(
        list({
          columns: [
            { header: "Hidden", field: "x", widthMm: 90, hidden: true },
          ],
        }),
      ),
    ).toThrow(/可见/);
  });
  it("validates new JSON models and rejects invalid compute/detail/aggregate inputs", () => {
    const valid = template(
      list({
        groups: [
          { field: "plant", aggregates: [{ field: "value", op: "avg" }] },
        ],
        computed: [{ field: "x", expression: { value: 1 } }],
        detail: {
          dataset: "lines",
          parentKey: "id",
          foreignKey: "master",
          columns: [{ field: "line", header: "Line", widthMm: 90 }],
        },
      }),
    );
    expect(validateReportTemplate(valid)).toMatchObject({ ok: true });
    const bad = template(
      list({
        computed: [{ field: "x", expression: { field: "x" } }],
        groups: [
          {
            field: "plant",
            aggregates: [{ field: "value", op: "weightedAvg" }],
          },
        ],
      }),
    );
    const result = validateReportTemplate(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.message).join(" ")).toMatch(
      /循环.*权重/,
    );
  });
  it("compares large decimal rule thresholds exactly", () => {
    expect(
      evalStyleRule(
        { n: "9007199254740993" },
        { field: "n", op: ">", value: 9007199254740992 },
      ),
    ).toBe(true);
  });
});
describe("true page iteration and matrices", () => {
  it("yields the first page before measuring later rows and matches the full collector", () => {
    let measurements = 0;
    const measurer: typeof heuristicMeasurer = {
      measureMm: (text, options) => {
        measurements++;
        return heuristicMeasurer.measureMm(text, options);
      },
    };
    const data = {
        rows: Array.from({ length: 10_000 }, (_, n) => ({
          id: String(n),
          value: n,
        })),
      },
      source = template();
    const iterator = paginateTemplatePages(source, data, { measurer });
    expect(measurements).toBe(0);
    const first = iterator.next().value;
    expect(first).toBeDefined();
    expect(measurements).toBeLessThan(100);
    iterator.return(undefined);
    const small = { rows: data.rows.slice(0, 25) };
    expect([...paginateTemplatePages(source, small)]).toEqual(
      paginateTemplate(source, small).plan.pages,
    );
    expect(countTemplatePages(source, small)).toBe(
      paginateTemplate(source, small).plan.pages.length,
    );
  });
  it("resolves page anchors without retaining the full plan, honors limits and cancellation", () => {
    const source = template(),
      data = {
        rows: Array.from({ length: 25 }, (_, n) => ({
          id: String(n),
          value: n,
        })),
      };
    source.pages[0]!.components.push({
      kind: "text",
      leftMm: 0,
      topMm: 0,
      widthMm: 10,
      heightMm: 2,
      text: "{page}/{totalPages}",
    });
    const result = [...paginateTemplatePages(source, data)];
    expect(result[0]!.components.at(-1)!.text).toBe(`1/${result.length}`);
    expect(() => [
      ...paginateTemplatePages(source, data, { maxPages: 1 }),
    ]).toThrow(/上限/);
    expect(() => [
      ...paginateTemplatePages(source, data, { signal: AbortSignal.abort() }),
    ]).toThrow(/取消/);
  });
  it("stops before appending a page that exceeds actual cells including repeated nested footers", () => {
    const source = template(list({ columns: [{ header: "Value", field: "value", widthMm: 90 }] }), 40);
    source.pages[0]!.components.push({ kind: "rect", pageAnchor: "footer", leftMm: 0, topMm: 34, widthMm: 90, heightMm: 5, grid: { cells: [[{ text: "Footer", children: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 2, heightMm: 1, grid: { cells: [[{ text: "nested" }]] } }] }]] } });
    const data = { rows: Array.from({ length: 12 }, (_, value) => ({ value })) };
    const iterator = paginateTemplatePages(source, data, { maxCells: 6 });
    expect(iterator.next().value).toBeDefined();
    expect(() => iterator.next()).toThrow(/单元格数量超出上限 6/);
    expect(() => paginateTemplate(source, data, { maxCells: 6 })).toThrow(/单元格数量超出上限/);
    expect(() => paginateTemplate(source, data, { maxCells: 0 })).toThrow(/maxCells/);
  });
  it("includes all physical merged header cells in early estimates", () => {
    const component = list({ columns: [{ header: "Value", field: "value", widthMm: 90 }], headerGrid: { cells: [[{ text: "Band" }], [{ text: "Value" }]], rowHeightsMm: [6,6] } });
    expect(estimateListLayoutCells(component, { rows: [{ value: 1 }] })).toBe(3);
  });
  it("reuses the prepared calculation pipeline across total-count and streaming passes", () => {
    let calls = 0;
    const source = template(list({ computed: [{ field: "copy", expression: "identity" }] }));
    source.pages[0]!.components.push({ kind: "text", leftMm: 0, topMm: 0, widthMm: 10, heightMm: 2, text: "{page}/{totalPages}" });
    const data = { rows: Array.from({ length: 25 }, (_, n) => ({ id: String(n), value: n })) };
    const pages = [...paginateTemplatePages(source, data, { formula: { evaluate: (_expression, { row }) => { calls++; return row.id; } } })];
    expect(pages.length).toBeGreaterThan(1); expect(calls).toBe(25);
  });
  it("known totals skip the count pass and produce identical page content", () => {
    const source = template(),
      data = {
        rows: Array.from({ length: 25 }, (_, n) => ({
          id: String(n),
          value: n,
        })),
      };
    source.pages[0]!.components.push({
      kind: "text",
      leftMm: 0,
      topMm: 0,
      widthMm: 10,
      heightMm: 2,
      text: "{page}/{totalPages}",
    });
    let counted = 0,
      known = 0;
    const slow = [
      ...paginateTemplatePages(source, data, {
        measurer: {
          measureMm: (text, options) => {
            counted++;
            return heuristicMeasurer.measureMm(text, options);
          },
        },
      }),
    ];
    const fast = [
      ...paginateTemplatePages(source, data, {
        knownTotalPages: slow.length,
        measurer: {
          measureMm: (text, options) => {
            known++;
            return heuristicMeasurer.measureMm(text, options);
          },
        },
      }),
    ];
    expect(fast).toEqual(slow);
    expect(counted).toBe(known * 2);
  });
  it("repeats text/image/grid page furniture, reserves their bands and replaces nested page tokens", () => {
    const source = template(),
      data = {
        rows: Array.from({ length: 20 }, (_, n) => ({
          id: String(n),
          value: n,
        })),
      };
    source.pages[0]!.components.push(
      {
        kind: "text",
        pageAnchor: "header",
        leftMm: 0,
        topMm: 0,
        widthMm: 90,
        heightMm: 15,
        text: "Company",
      },
      {
        kind: "image",
        pageAnchor: "header",
        leftMm: 90,
        topMm: 0,
        widthMm: 10,
        heightMm: 10,
        imageData: "data:image/png;base64,eA==",
      },
      {
        kind: "rect",
        pageAnchor: "footer",
        leftMm: 0,
        topMm: 55,
        widthMm: 90,
        heightMm: 5,
        grid: { cells: [[{ text: "Page {page}/{totalPages}" }]] },
      },
    );
    const pages = [...paginateTemplatePages(source, data)];
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((page, index) => {
      const rows = page.components.filter((item) => item.table);
      expect(rows[0]!.topMm).toBe(15);
      expect(
        Math.max(...rows.map((item) => item.topMm + item.heightMm)),
      ).toBeLessThanOrEqual(55);
      expect(
        page.components.filter((item) => item.pageAnchor === "header"),
      ).toHaveLength(2);
      expect(
        page.components.find((item) => item.pageAnchor === "footer")!.grid!
          .cells[0]![0]!.text,
      ).toBe(`Page ${index + 1}/${pages.length}`);
    });
    expect(pages).toEqual(paginateTemplate(source, data).plan.pages);
  });
  it("estimates nested/detail allocation conservatively without child multiplication", () => {
    const component = list({
      groups: [{ field: "plant" }],
      detail: {
        dataset: "lines",
        parentKey: "id",
        foreignKey: "id",
        columns: [{ header: "Line", field: "n", widthMm: 90 }],
      },
    });
    expect(
      estimateListLayoutCells(component, {
        rows,
        lines: [
          { id: "1", n: 4 },
          { id: "2", n: 3 },
        ],
      }),
    ).toBe((3 * 3 + 1) * 3 + 2 + 3);
  });
  it("conditions can reference computed fields and hidden values cannot be edited", () => {
    const component = list({
      computed: [
        {
          field: "x",
          expression: { op: "add", args: [{ field: "value" }, { value: 1 }] },
        },
      ],
      rowVisibleWhen: { field: "x", op: ">", value: 10 },
    });
    expect(
      flat(paginateTemplate(template(component), { rows })).filter(
        (item) => item.table?.role === "body",
      ),
    ).toHaveLength(2);
    const hidden = list({
      columns: [
        {
          header: "Value",
          field: "value",
          widthMm: 90,
          editable: true,
          visibleWhen: { field: "id", op: "==", value: "never" },
        },
      ],
    });
    expect(
      flat(paginateTemplate(template(hidden), { rows }))[1]!.grid!.cells[0]![0]!
        .editable,
    ).toBe(false);
  });
  it("re-evaluates a saved matrix per query and never assigns source edit identities", () => {
    const component = list({
      layout: "wide",
      rowKey: "id",
      matrix: {
        rowFields: ["plant"],
        columnFields: ["shift"],
        measures: [{ field: "value", op: "avg" }],
        totals: true,
      },
    });
    const first = paginateTemplate(template(component), { rows });
    const header = flat(first).find((item) => item.table?.role === "header")!;
    expect(header.grid!.cells[0]).toHaveLength(4);
    for (const item of flat(first).filter(
      (item) => item.table?.role === "body",
    )) {
      expect(item.table!.source).toBeUndefined();
      expect(
        item.grid!.cells[0]!.every((cell) => cell?.editable === false),
      ).toBe(true);
    }
    const second = paginateTemplate(template(component), {
      rows: [{ plant: "P", shift: "new", value: 2 }],
    });
    expect(
      flat(second).find((item) => item.table?.role === "header")!.grid!
        .cells[0],
    ).toHaveLength(3);
    expect(estimateListLayoutCells(component, { rows })).toBe(16);
    expect(first.plan.pages[0]!.pageWidthMm).toBeGreaterThanOrEqual(
      5 + 40 + 28 * 3,
    );
    expect(validateReportTemplate(template(component)).ok).toBe(true);
  });
  it("budgets matrix expansion after computed dimensions and rejects layout combinations", () => {
    const component = list({
      computed: [{ field: "dynamic", expression: { field: "id" } }],
      matrix: {
        rowFields: ["dynamic"],
        columnFields: ["shift"],
        measures: [{ field: "value", op: "sum" }],
      },
    });
    expect(estimateListLayoutCells(component, { rows })).toBe(12);
    expect(() =>
      paginateTemplate(
        template({ ...component, groups: [{ field: "plant" }] }),
        { rows },
      ),
    ).toThrow(/矩阵/);
    expect(
      validateReportTemplate(
        template({
          ...component,
          detail: {
            dataset: "lines",
            parentKey: "id",
            foreignKey: "master",
            columns: [],
          },
        }),
      ).ok,
    ).toBe(false);
    expect(() =>
      createMatrixTable(new Array(100_001), component.matrix!),
    ).toThrow(/输入/);
  });
  it("matrix COUNT(field) skips null values and preserves zero consistently with other scopes", () => {
    const result = createMatrixTable([{ p: "A", c: "D", v: null }, { p: "A", c: "D", v: 0 }, { p: "A", c: "N", v: 2 }], { rowFields: ["p"], columnFields: ["c"], measures: [{ field: "v", op: "count" }], totals: true });
    expect(result.rows[0]).toMatchObject({ c0_0: 1, c1_0: 1, total_0: 2 });
    expect(result.rows.at(-1)!.total_0).toBe(2);
  });
  it("supports multiple aggregates of the same measure without reserved-field collisions", () => {
    const result = createMatrixTable(
      [
        { p: "A", shift: "D", __matrix_row: 3 },
        { p: "A", shift: "D", __matrix_row: 5 },
      ],
      {
        rowFields: ["p"],
        columnFields: ["shift"],
        measures: [
          { field: "__matrix_row", op: "sum" },
          { field: "__matrix_row", op: "avg" },
        ],
      },
    );
    expect(result.rows[0]).toMatchObject({ c0_0: 8, c0_1: 4 });
  });
  it("builds dynamic multidimension/multimeasure matrices and correct raw totals", () => {
    const result = createMatrixTable(rows, {
      rowFields: ["plant"],
      columnFields: ["shift"],
      measures: [
        { field: "value", op: "avg", label: "Average" },
        { field: "valueSum", valueField: "value", op: "sum" },
      ],
      totals: true,
    });
    expect(result.columns.map((column) => column.header)).toEqual([
      "plant",
      "day · Average",
      "night · Average",
      "合计 · Average",
      "day · valueSum (sum)",
      "night · valueSum (sum)",
      "合计 · valueSum (sum)",
    ]);
    expect(result.rows.at(-1)).toMatchObject({
      rowLabel: "合计",
      total_0: 10,
      total_1: 30,
    });
    expect(result.rows[1]).toMatchObject({
      rowLabel: "B",
      c0_0: 20,
      c1_0: null,
    });
    expect(() =>
      createMatrixTable(rows, {
        rowFields: ["plant"],
        columnFields: ["shift"],
        measures: [{ field: "value", op: "sum" }],
        maxCells: 1,
      }),
    ).toThrow(/maxCells/);
  });
});
