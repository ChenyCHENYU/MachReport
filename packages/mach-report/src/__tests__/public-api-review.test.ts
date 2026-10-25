// @vitest-environment node
import { describe, expect, it } from "vitest";
import { comparePublicApi } from "../../../../scripts/public-api-diff.mjs";

describe("public API review receipt", () => {
  it("reports removed exports/assets and every changed signature, including added required arguments", () => {
    const before = { exports: { ".": { create: "create:old", old: "old:1", stable: "stable:1" }, "./removed": { fn: "fn:1" } }, assets: { "./style.css": "dist/old.css", "./removed.css": "dist/removed.css" } };
    const after = { exports: { ".": { create: "create:new-required-param", stable: "stable:1", added: "added:1" } }, assets: { "./style.css": "dist/new.css", "./new.css": "dist/new.css" } };
    expect(comparePublicApi(before, after)).toEqual({
      addedExports: [{ entry: ".", name: "added" }], removedExports: [{ entry: ".", name: "old" }, { entry: "./removed", name: "fn" }], changedSignatures: [{ entry: ".", name: "create" }],
      addedAssets: ["./new.css"], removedAssets: ["./removed.css"], changedAssets: ["./style.css"]
    });
    expect(comparePublicApi(after, after).changedSignatures).toEqual([]);
    expect(comparePublicApi({}, {})).toMatchObject({ removedExports: [], addedExports: [], changedSignatures: [] });
  });
});
