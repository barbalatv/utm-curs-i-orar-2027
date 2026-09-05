import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: { SCHEDULE_DATA_DIR: ".test-data", DATABASE_URL: "" },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
