import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real-browser (Playwright) flows need more than the 5s default; run test files serially so
    // multiple Chromium instances don't contend on the sandbox.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
