import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    // Allow the `.js` specifier used in source imports to resolve to `.ts` in tests.
    extensions: [".ts", ".js"],
  },
});
