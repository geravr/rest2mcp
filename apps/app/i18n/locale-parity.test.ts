import { describe, expect, it } from "vitest";
import { en } from "./locales/en";
import { es } from "./locales/es";

function flatten(value: unknown, prefix = ""): Map<string, unknown> {
  const result = new Map<string, unknown>();
  if (value === null || typeof value !== "object") {
    result.set(prefix, value);
    return result;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    for (const [childPath, childValue] of flatten(child, path)) {
      result.set(childPath, childValue);
    }
  }
  return result;
}

describe("locale parity", () => {
  const enKeys = flatten(en);
  const esKeys = flatten(es);

  it("defines exactly the same keys in en and es", () => {
    const missingInEs = [...enKeys.keys()].filter((key) => !esKeys.has(key));
    const extraInEs = [...esKeys.keys()].filter((key) => !enKeys.has(key));
    expect(missingInEs).toEqual([]);
    expect(extraInEs).toEqual([]);
  });

  it("never ships an empty string in either locale", () => {
    for (const [locale, keys] of [
      ["en", enKeys],
      ["es", esKeys],
    ] as const) {
      for (const [key, value] of keys) {
        if (typeof value !== "string") continue;
        expect(value.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("covers every platform token event and scope label in both locales", () => {
    const requiredSuffixes = [
      "scopes.read",
      "scopes.observe",
      "scopes.author",
      "scopes.publish",
      "scopes.invoke",
      "scopes.invoke_mutation",
      "scopes.secret_reference",
      "scopes.destructive",
      "activity.tokenIssued",
      "activity.tokenRotated",
      "activity.tokenRevoked",
      "activity.scopeDenied",
      "activity.resourceDenied",
      "activity.stepUpFailed",
      "activity.destructiveAction",
      "activity.mutatingInvocation",
    ];
    for (const suffix of requiredSuffixes) {
      expect(enKeys.has(`settings.platform.${suffix}`)).toBe(true);
      expect(esKeys.has(`settings.platform.${suffix}`)).toBe(true);
    }
  });
});
