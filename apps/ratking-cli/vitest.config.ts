import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/ratking-cli/test/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
