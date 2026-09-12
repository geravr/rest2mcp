import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin router list inputs", () => {
  const source = readFileSync(new URL("./admin.ts", import.meta.url), "utf8");

  it("does not accept limit as the audit log paging control", () => {
    expect(source).not.toMatch(/limit:\s*z\.number/);
    expect(source).toContain("auditLogListInputSchema");
    expect(source).toContain("paginationInputSchema");
  });
});
