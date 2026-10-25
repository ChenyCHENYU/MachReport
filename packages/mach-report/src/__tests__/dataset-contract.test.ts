// @vitest-environment node
import { describe, expect, it } from "vitest";
import { columnsFromContract, createReportSource, createTableTemplate, datasetJsonSchema, explainDatasetField, validateDatasetRows, type DatasetContract } from "../index";

const contract: DatasetContract = { rowKey: "id", fields: [
  { field: "id", type: "text", label: "炉号", semanticRole: "identifier" },
  { field: "weight", type: "number", min: 0, required: true, unit: "kg" },
  { field: "date", type: "date", nullable: true },
  { field: "amount", type: "decimal" },
  { field: "active", type: "boolean", required: true }
] };

describe("前后端共用数据契约", () => {
  it("运行时错误类型的enum/rowKey不会因假值被静默忽略", () => {
    for (const value of [false, null, 0, "", {}]) {
      const badEnum = { fields: [{ field: "x", type: "text", enum: value }] } as unknown as DatasetContract;
      expect(() => validateDatasetRows([{ x: "ok" }], badEnum)).toThrow(/enum/);
      const badKey = { rowKey: value, fields: [{ field: "x", type: "text" }] } as unknown as DatasetContract;
      expect(() => datasetJsonSchema(badKey)).toThrow(/rowKey/);
    }
  });
  it("保留编号前导零/精确小数/0/false，拒绝数值字符串与无效日期", () => {
    const row = { id: "000001", weight: 0, date: "2024-02-29", amount: "12345678901234567890.123456", active: false };
    expect(validateDatasetRows([row], contract).ok).toBe(true);
    expect(row.amount).toBe("12345678901234567890.123456");
    const result = validateDatasetRows([{ ...row, weight: "0", date: "2026-02-29" }, { ...row }], contract, { path: "$.datasets.heats" });
    expect(result.issues.map((issue) => issue.code)).toEqual(["type", "type", "row-key"]);
    expect(result.issues[0]?.path).toBe("$.datasets.heats[0].weight");
    expect(validateDatasetRows([{ ...row, id: null }], contract).ok).toBe(false);
  });

  it("契约可生成列与JSON Schema，主键非空与nullable语义一致", () => {
    const columns = columnsFromContract(contract);
    expect(columns[0]).toMatchObject({ field: "id", header: "炉号", semanticRole: "identifier" });
    expect(columns[1]?.header).toBe("weight (kg)");
    const schema = datasetJsonSchema(contract) as { items: { properties: Record<string, { type: string | string[]; minLength?: number }>; required: string[] } };
    expect(schema.items.properties.id?.type).toBe("string");
    expect(schema.items.properties.id?.minLength).toBe(1);
    expect(schema.items.properties.date?.type).toEqual(["string", "null"]);
    expect(schema.items.required).toEqual(["id", "weight", "active"]);
    expect(() => datasetJsonSchema({ fields: [{ field: "__proto__", type: "text" }] })).toThrow(/安全/);
    expect(validateDatasetRows([{}], contract, { maxCells: 1 }).issues[0]?.code).toBe("budget");
  });

  it("取数后分页前拒绝缺失或不合法数据集，错误保持validate分类", async () => {
    const template = createTableTemplate({ columns: columnsFromContract(contract) });
    const source = createReportSource({ daily: { template, datasets: { detail: [{ id: "x", weight: "bad", active: false }] }, dataSchema: { detail: contract } } });
    await expect(source({ reportIds: ["daily"], params: {} })).rejects.toMatchObject({ code: "validate", cause: { issues: [{ code: "type", field: "weight" }] } });
    const missing = createReportSource({ daily: { template, datasets: {}, dataSchema: { detail: contract } } });
    await expect(missing({ reportIds: ["daily"], params: {} })).rejects.toMatchObject({ code: "validate" });
  });

  it("枚举遵循字段类型，文本长度按Unicode字符与JSON Schema一致", () => {
    expect(() => datasetJsonSchema({ fields: [{ field: "qty", type: "number", enum: ["1"] }] })).toThrow(/enum/);
    expect(() => datasetJsonSchema({ fields: [{ field: "date", type: "date", enum: ["2026-02-29"] }] })).toThrow(/enum/);
    const emoji: DatasetContract = { fields: [{ field: "name", type: "text", minLength: 1, maxLength: 1 }] };
    expect(validateDatasetRows([{ name: "😀" }], emoji).ok).toBe(true);
    expect(validateDatasetRows([{ name: "😀甲" }], emoji).issues[0]?.code).toBe("range");
  });
  it("shares explicit business semantics, formatting and locatable calculation explanations without changing values", async () => {
    const metric: DatasetContract = { fields: [
      { field: "energy", type: "decimal", unit: "kWh", aggregation: "sum", format: { kind: "number", digits: 3 } },
      { field: "weight", type: "decimal", aggregation: "sum" },
      { field: "consumption", type: "decimal", aggregation: "none", description: "按业务口径核算", missingMeaning: "缺少重量或用电量来源", calculation: { description: "用电量除以钢水重，重量为0时由业务决定结果", dependsOn: ["energy", "weight"] }, format: { kind: "number", digits: 2 } }
    ] };
    const columns = columnsFromContract(metric);
    expect(columns[0]).toMatchObject({ header: "energy (kWh)", format: { kind: "number", digits: 3 } });
    const schema = datasetJsonSchema(metric) as { items: { properties: Record<string, Record<string, unknown>> } };
    expect(schema.items.properties.consumption).toMatchObject({ "x-report-aggregation": "none", "x-report-calculation": { dependsOn: ["energy", "weight"] }, "x-report-missingMeaning": "缺少重量或用电量来源" });
    const diagnostics = explainDatasetField(metric, { datasetId: "detail", field: "consumption", rowKey: "0001" });
    expect(diagnostics.map(entry => entry.code)).toEqual(["field-definition", "field-calculation"]);
    expect(diagnostics[1]?.target).toMatchObject({ rowKey: "0001", field: "consumption" });
    const query = createReportSource({ report: { template: createTableTemplate({ columns }), dataSchema: { detail: metric }, provider: { query: () => ({ datasets: { detail: [{ energy: "12345678901234567890.1", weight: "0", consumption: null }] }, diagnostics }) } } });
    let received: unknown;
    await query({ reportIds: ["report"], params: {}, onQueryResult: (_id, result) => { received = result; } });
    expect(received).toMatchObject({ diagnostics, datasets: { detail: [{ weight: "0", consumption: null }] } });
    expect(() => explainDatasetField(metric, { datasetId: "detail", field: "unknown" })).toThrow(/声明/);
    expect(() => explainDatasetField(metric, { datasetId: "", field: "energy" })).toThrow(/目标/);
  });
  it("rejects ambiguous metric configuration, missing/cyclic dependencies and incompatible display types", () => {
    const bad = (field: Record<string, unknown>) => ({ fields: [{ field: "a", type: "decimal", ...field }] }) as DatasetContract;
    for (const field of [{ aggregation: "guess" }, { format: { kind: "number", digits: -1 } }, { format: { kind: "number", thousands: "yes" } }, { format: { kind: "date" } }, { description: "" }, { calculation: { description: "bad", dependsOn: [] } }, { calculation: { description: "bad", dependsOn: ["a", "a"] } }]) expect(() => datasetJsonSchema(bad(field))).toThrow(/契约/);
    expect(() => datasetJsonSchema({ fields: [{ field: "a", type: "text", aggregation: "sum" }] })).toThrow(/数值聚合/);
    expect(() => datasetJsonSchema({ fields: [{ field: "a", type: "text", format: { kind: "percent" } }] })).toThrow(/数值显示/);
    expect(() => datasetJsonSchema({ fields: [{ field: "a", type: "date", format: { kind: "date", pattern: "" } }] })).toThrow(/日期格式/);
    expect(() => datasetJsonSchema(bad({ calculation: { description: "test", dependsOn: ["missing"] } }))).toThrow(/未声明/);
    expect(() => datasetJsonSchema(bad({ calculation: { description: "test", dependsOn: ["a"] } }))).toThrow(/循环/);
    expect(() => datasetJsonSchema({ fields: [{ field: "a", type: "decimal", calculation: { description: "a", dependsOn: ["b"] } }, { field: "b", type: "decimal", calculation: { description: "b", dependsOn: ["a"] } }] })).toThrow(/循环/);
    const shared: DatasetContract = { fields: [{ field: "a", type: "number" }, { field: "b", type: "number", calculation: { description: "b", dependsOn: ["a"] } }, { field: "c", type: "number", calculation: { description: "c", dependsOn: ["a", "b"] } }] };
    expect(() => datasetJsonSchema(shared)).not.toThrow();
    expect(validateDatasetRows([{ a: 1, b: 2, c: 3 }], shared).ok).toBe(true);
  });
});
