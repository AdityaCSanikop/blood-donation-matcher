import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

// Tests always run against the dedicated TEST databases from .env.test.
dotenv.config({ path: path.resolve(import.meta.dirname, ".env.test"), override: true, quiet: true });

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/db/**/*.test.ts", "tests/services/**/*.test.ts"],
    fileParallelism: false, // one real database is shared by all files
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
