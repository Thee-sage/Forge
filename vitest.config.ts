import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "evaluation/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
