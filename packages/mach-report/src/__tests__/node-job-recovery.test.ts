// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openFileReportJobStore } from "../server/node-job-store";

describe("durable job directory recovery", () => {
  it("removes only orphaned adapter temporary files after acquiring exclusive ownership", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "report-pending-"));
    try {
      const orphan = ".pending-00000000-0000-4000-8000-000000000001";
      await writeFile(path.join(directory, orphan), "uncommitted bytes");
      await writeFile(path.join(directory, ".pending-personal-note"), "keep");
      const store = await openFileReportJobStore({ directory, maxBytes: 1 });
      expect(await readdir(directory)).not.toContain(orphan);
      expect(await readFile(path.join(directory, ".pending-personal-note"), "utf8")).toBe("keep");
      await store.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each(["", "null", "{invalid"])("fails closed for an incomplete or corrupt lock %j", async (text) => {
    const directory = await mkdtemp(path.join(tmpdir(), "report-lock-"));
    try {
      await writeFile(path.join(directory, ".writer-lock"), text);
      await expect(openFileReportJobStore({ directory, recoverDeadOwner: true })).rejects.toMatchObject({ code: "conflict" });
      expect(await readFile(path.join(directory, ".writer-lock"), "utf8")).toBe(text);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
