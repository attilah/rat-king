import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/remembers/test/**/*.test.ts"],
    name: "remembers",
  },
});
