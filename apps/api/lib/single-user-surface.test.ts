import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("single-user product surface", () => {
  it("does not register the Better Auth organization plugin", () => {
    const authSource = readFileSync(
      new URL("./auth.ts", import.meta.url),
      "utf8",
    );

    expect(authSource).not.toContain('from "better-auth/plugins"');
    expect(authSource).not.toContain("organization(");
    expect(authSource).not.toContain("organization-access");
  });

  it("does not mount an organization tRPC router", () => {
    const appSource = readFileSync(
      new URL("./app.ts", import.meta.url),
      "utf8",
    );

    expect(appSource).not.toContain("organizationRouter");
    expect(appSource).not.toMatch(/organization:\s/);
    expect(
      existsSync(new URL("../routers/organization.ts", import.meta.url)),
    ).toBe(false);
  });

  it("does not ship organization-access helpers", () => {
    expect(
      existsSync(new URL("./organization-access.ts", import.meta.url)),
    ).toBe(false);
  });
});
