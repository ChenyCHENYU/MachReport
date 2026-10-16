// @vitest-environment node
import { describe, expect, it } from "vitest";
import { columnsFromContract, createReportSource, createTableTemplate, datasetJsonSchema, validateDatasetRows, type DatasetContract } from "../index";

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
});
