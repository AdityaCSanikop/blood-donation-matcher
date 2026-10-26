import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

dotenv.config({ path: path.resolve(import.meta.dirname, ".env.test"), override: true, quiet: true });

/** API tests talk HTTP to a real `next start` server (see tests/api/global-setup.ts). */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/api/**/*.test.ts"],
    globalSetup: ["tests/api/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
