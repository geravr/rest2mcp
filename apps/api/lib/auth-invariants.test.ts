import { identity, user } from "@repo/db";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUTH_EMAIL_OTP_DISABLE_SIGN_UP,
  AUTH_PRIVILEGED_FIELD_INPUT,
} from "./auth.js";

describe("auth privileged field invariants", () => {
  it("disables client input on privileged additionalFields", () => {
    expect(AUTH_PRIVILEGED_FIELD_INPUT).toEqual({
      role: false,
      bannedAt: false,
      bannedReason: false,
    });
  });

  it("disables native email OTP sign-up via the wired config constant", () => {
    expect(AUTH_EMAIL_OTP_DISABLE_SIGN_UP).toBe(true);
  });

  it("keeps privileged field input flags false in the shared config object", () => {
    expect(
      Object.values(AUTH_PRIVILEGED_FIELD_INPUT).every((v) => v === false),
    ).toBe(true);
  });

  it("does not register onboardingCompletedAt as an additionalField", () => {
    const authSource = readFileSync(
      new URL("./auth.ts", import.meta.url),
      "utf8",
    );

    expect(
      Object.hasOwn(AUTH_PRIVILEGED_FIELD_INPUT, "onboardingCompletedAt"),
    ).toBe(false);
    expect(authSource).not.toContain("onboardingCompletedAt");
  });
});

describe("Better Auth 1.7.3 identity schema", () => {
  it("keeps email-OTP-only config and the identity model name", () => {
    const authSource = readFileSync(
      new URL("./auth.ts", import.meta.url),
      "utf8",
    );

    expect(authSource).toContain('modelName: "identity"');
    expect(authSource).toContain("emailOTP(");
    expect(authSource).not.toContain("identityStrategy");
    expect(authSource).not.toContain(
      'from "better-auth/plugins/generic-oauth"',
    );
  });

  it("does not require identity.issuer because 1.7.3 never writes it", () => {
    const columns = getTableColumns(identity);
    const unique = getTableConfig(identity).uniqueConstraints.find(
      (constraint) => constraint.name === "identity_provider_account_unique",
    );

    expect(columns.providerId).toBeDefined();
    expect(columns.accountId).toBeDefined();
    expect(Object.hasOwn(columns, "issuer")).toBe(false);
    expect(unique?.columns.map((column) => column.name)).toEqual([
      "providerId",
      "accountId",
    ]);
  });
});

describe("starter onboarding surface", () => {
  it("does not persist an onboarding column on user", () => {
    expect(Object.hasOwn(getTableColumns(user), "onboardingCompletedAt")).toBe(
      false,
    );
  });

  it("does not register completeOnboarding on the user router", () => {
    const userRouterSource = readFileSync(
      new URL("../routers/user.ts", import.meta.url),
      "utf8",
    );

    expect(userRouterSource).not.toContain("completeOnboarding");
  });
});
