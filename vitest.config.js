import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["party-kit/test/**/*.test.js", "cork-and-bell/test/**/*.test.js"], environment: "node" },
});
