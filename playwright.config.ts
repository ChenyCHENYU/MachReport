import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  retries: 1,
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 }
  },
  webServer: [
    {
      command: "pnpm --filter @mach-report/example-minimal dev",
      url: "http://localhost:8610",
      reuseExistingServer: true,
      timeout: 60000
    },
    {
      command: "pnpm --filter @mach-report/example-fed-host dev",
      url: "http://localhost:8611",
      reuseExistingServer: true,
      timeout: 60000
    }
  ]
});
