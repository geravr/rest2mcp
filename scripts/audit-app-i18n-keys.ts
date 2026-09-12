/**
 * Lists translation keys defined in apps/app/i18n that have no reference in SPA source.
 *
 * Usage: bun scripts/audit-app-i18n-keys.ts
 */
import { en } from "../apps/app/i18n/locales/en/index.ts";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");

const DYNAMIC_PREFIXES = ["layout.nav", "admin.auditLog", "errors.codes"];

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

async function loadSource(): Promise<string> {
  const glob = new Bun.Glob("apps/app/**/*.{ts,tsx}");
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: ROOT, absolute: true })) {
    if (file.includes("/i18n/")) continue;
    files.push(file);
  }
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

function isReferenced(key: string, source: string): boolean {
  const tKey = `t.${key}`;
  if (source.includes(tKey)) return true;

  for (const prefix of DYNAMIC_PREFIXES) {
    if (key.startsWith(prefix)) return true;
  }

  return false;
}

const keys = flattenKeys(en).sort();
const source = await loadSource();
const unreferenced = keys.filter((key) => !isReferenced(key, source));

console.log(`Defined keys: ${keys.length}`);
console.log(`Unreferenced keys: ${unreferenced.length}`);
for (const key of unreferenced) {
  console.log(`  - ${key}`);
}
