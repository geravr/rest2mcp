import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/** Active KEY=value lines (not comments). Prefix matches allow PROVIDER_WEBHOOK_*. */
const GHOST_KEY_PATTERNS = [
  /^OPENAI_API_KEY=/,
  /^GA_MEASUREMENT_ID=/,
  /^GOOGLE_CLOUD_PROJECT=/,
  /^GOOGLE_CLIENT_ID=/,
  /^GOOGLE_CLIENT_SECRET=/,
  /^COMPOSIO_/,
  /^PROVIDER_WEBHOOK_/,
  /^STORAGE_S3_SIGNED_URL_TTL_SECONDS=/,
  /^API_URL=/,
];

function activeAssignmentLines(contents: string): string[] {
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

describe("committed env examples", () => {
  it("root .env.example has no denylisted ghost active keys", () => {
    const contents = readFileSync(resolve(REPO_ROOT, ".env.example"), "utf8");
    const active = activeAssignmentLines(contents);
    const hits = active.filter((line) =>
      GHOST_KEY_PATTERNS.some((pattern) => pattern.test(line)),
    );

    expect(hits).toEqual([]);
  });

  it("apps/web/.env.example has no denylisted ghost active keys", () => {
    const contents = readFileSync(
      resolve(REPO_ROOT, "apps/web/.env.example"),
      "utf8",
    );
    const active = activeAssignmentLines(contents);
    const hits = active.filter((line) =>
      GHOST_KEY_PATTERNS.some((pattern) => pattern.test(line)),
    );

    expect(hits).toEqual([]);
  });

  it("root .env.example documents marketing PUBLIC origins", () => {
    const contents = readFileSync(resolve(REPO_ROOT, ".env.example"), "utf8");
    expect(contents).toMatch(/^PUBLIC_APP_ORIGIN=/m);
    expect(contents).toMatch(/^PUBLIC_SPA_ORIGIN=/m);
  });
});
