import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "@playwright/test";

// The browser tests use the TEST databases, reloaded with the demo data first.
dotenv.config({ path: path.resolve(__dirname, ".env.test"), override: true, quiet: true });

const PORT = 3102;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1360, height: 900 },
    // Set PW_CHROMIUM_PATH to reuse an installed Chromium instead of `npx playwright install chromium`.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...(process.env as Record<string, string>), NODE_ENV: "production" },
  },
});
