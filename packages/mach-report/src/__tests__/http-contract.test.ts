// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createReportOpenApi, createReportRuntime, reportHttpError } from "../server";
import { createTableTemplate } from "../index";

describe("framework-independent HTTP contract", () => {
  it("describes real routes, string wire parameters, typed schema and exact-decimal datasets", () => {
    const runtime = createReportRuntime({ reports: { sales: {
      template: createTableTemplate({ columns: [{ field: "amount", header: "Amount" }] }), params: [{ field: "limit", type: "number", required: true }, { field: "defaulted", required: true, defaultValue: "yes" }],
      dataSchema: { detail: { fields: [{ field: "amount", type: "decimal", aggregation: "sum", format: { kind: "number", digits: 2 } }] } }, datasets: { detail: [] }
    } } });
    const api = createReportOpenApi(runtime.describe()) as { openapi: string; paths: Record<string, { post: { requestBody: { content: Record<string, { schema: { properties: { params: { required: string[]; properties: Record<string, unknown>; "x-report-typedSchema": unknown } } } }> }; responses: Record<string, unknown> } }> };
    expect(api.openapi).toBe("3.1.0");
    const route = api.paths["/reports/sales/prepare"]!.post;
    const params = route.requestBody.content["application/json"]!.schema.properties.params;
    expect(params.properties.limit).toEqual({ type: "string" }); expect(params.required).toEqual(["limit"]);
    expect(params["x-report-typedSchema"]).toBeDefined();
    expect(route.responses["429"]).toBeDefined(); expect(api.paths["/reports/sales/export/xlsx"]).toBeDefined();
    expect(JSON.stringify(api)).toContain("x-report-aggregation");
    expect(() => createReportOpenApi(runtime.describe(), { basePath: "/reports/" })).toThrow(/basePath/);
    expect(() => createReportOpenApi([...runtime.describe(), ...runtime.describe()])).toThrow(/唯一/);
  });
  it("maps known failures consistently, retains validation paths and hides unknown exception details", () => {
    expect(reportHttpError(Object.assign(new Error("bad input"), { code: "validate", cause: { issues: [{ field: "qty", message: "type", value: "secret" }] } }), "request-1")).toEqual({ status: 422, body: { error: { code: "validate", message: "bad input", correlationId: "request-1", issues: [{ field: "qty", message: "type" }] } } });
    for (const [code, status] of [["timeout", 504], ["queue-full", 429], ["conflict", 409], ["capacity", 413], ["missing", 404]]) expect(reportHttpError({ code }, "id").status).toBe(status);
    expect(reportHttpError(new Error("database password"), "id")).toEqual({ status: 500, body: { error: { code: "internal", message: "Report execution failed", correlationId: "id" } } });
    expect(reportHttpError({ code: "toString", message: "private" }, "id").status).toBe(500);
    expect(reportHttpError({ name: "AbortError" }, "id").status).toBe(499);
    expect(reportHttpError({ code: "budget", path: "$.budget" }, "id").body.error.path).toBe("$.budget");
    expect(reportHttpError(null, "id").status).toBe(500);
  });
});
