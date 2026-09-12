import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const seedScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/scripts/seed.ts",
);

describe("production seed guard", () => {
  it("exits non-zero when ENVIRONMENT=prod without ALLOW_PROD_SEED", () => {
    const result = spawnSync("bun", [seedScript], {
      env: {
        ...process.env,
        ENVIRONMENT: "prod",
        ALLOW_PROD_SEED: "",
        DATABASE_URL: "postgres://localhost/unused",
      },
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(
      /Refusing to seed production/,
    );
  });

  it("exits non-zero when ENVIRONMENT=production without ALLOW_PROD_SEED", () => {
    const result = spawnSync("bun", [seedScript], {
      env: {
        ...process.env,
        ENVIRONMENT: "production",
        ALLOW_PROD_SEED: "",
        DATABASE_URL: "postgres://localhost/unused",
      },
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(
      /Refusing to seed production/,
    );
  });
});
