import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/remembers-host/test/**/*.test.ts"],
    name: "remembers-host",
  },
});
