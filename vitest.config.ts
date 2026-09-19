import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Load the root `.env` before project configs run so database-backed
 * integration tests can detect `DATABASE_URL` instead of silently skipping
 * when the runner is `vitest` (Bun's `bun test` already loads it).
 */
const envPath = fileURLToPath(new URL(".env", import.meta.url));
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!;
    if (process.env[key] !== undefined) continue;
    // Strip an inline comment only for unquoted values, then strip one
    // matching pair of surrounding quotes.
    let value = match[2]!.trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      const end = value.indexOf(quote, 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    process.env[key] = value;
  }
}

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
