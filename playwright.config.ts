import { defineConfig } from "@playwright/test";
import { assertBrowserLaunchAllowed } from "./scripts/browser-preflight.mjs";

assertBrowserLaunchAllowed();
const reuseExistingServer = !process.env.CI && process.env.MR_E2E_OWN_SERVERS !== "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  retries: 0,
  use: {
    headless: true,
    // Local fixtures must not depend on the developer's macOS/system proxy.
    launchOptions: { firefoxUserPrefs: { "network.proxy.type": 0 } },
    viewport: { width: 1440, height: 900 }
  },
  webServer: [
    {
      command: "pnpm --filter @agile-team/example-minimal dev",
      url: "http://localhost:8610",
      reuseExistingServer,
      timeout: 60000
    },
    {
      command: "pnpm --filter @agile-team/example-fed-host dev",
      url: "http://localhost:8611",
      reuseExistingServer,
      timeout: 60000
    }
  ]
});
