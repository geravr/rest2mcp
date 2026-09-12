import { defineConfig } from "vitest/config";

/**
 * Vitest configuration.
 *
 * @see https://vitest.dev/config/
 */
export default defineConfig({
  cacheDir: "./.cache/vite",
  test: {
    projects: ["packages/core", "apps/api", "apps/app", "scripts"],
  },
});
