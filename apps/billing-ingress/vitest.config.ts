import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [".agent_sources/**", "node_modules/**"],
    include: [
      "apps/billing-ingress/*.test.ts",
      "stacks/billing/*.test.ts",
      "stacks/nest/billing*.test.ts",
    ],
  },
});
