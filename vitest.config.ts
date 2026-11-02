import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000,
    globalSetup: ["tests/support/global-setup.ts"],
  },
});
