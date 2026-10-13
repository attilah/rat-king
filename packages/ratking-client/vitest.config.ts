import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/ratking-client/test/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
