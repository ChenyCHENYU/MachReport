// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertBrowserLaunchAllowed } from "../../../../scripts/browser-preflight.mjs";

describe("macOS browser launch preflight", () => {
  it("refuses the desktop seatbelt environment with an actionable command", () => {
    expect(() => assertBrowserLaunchAllowed("darwin", { CODEX_SANDBOX: "seatbelt" })).toThrow(/sandbox_permissions=require_escalated/);
  });
  it("allows the approved execution environment and ordinary project terminals", () => {
    expect(() => assertBrowserLaunchAllowed("darwin", {})).not.toThrow();
    expect(() => assertBrowserLaunchAllowed("linux", { CODEX_SANDBOX: "seatbelt" })).not.toThrow();
  });
});
