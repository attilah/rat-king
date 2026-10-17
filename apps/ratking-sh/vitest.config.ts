import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/ratking-sh/test/**/*.test.ts",
      "packages/lexicon/test/trust*.test.ts",
    ],
  },
});
