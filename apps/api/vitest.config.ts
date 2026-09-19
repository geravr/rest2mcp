import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

/**
 * Load the repo-root `.env` for the API workspace too, so `bun api:test`
 * (which runs `vitest` in this folder) does not silently skip the
 * database-backed integration tests.
 */
const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
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

export default defineProject({});
