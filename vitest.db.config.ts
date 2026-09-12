import path from "node:path";
import { defineConfig } from "vitest/config";

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error(
    "DATABASE_URL is required for PostgreSQL integration tests; point it at a disposable local test database",
  );
}

export default defineConfig({
  test: {
    include: ["tests/db-integration/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
