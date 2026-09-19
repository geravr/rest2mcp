import { describe, expect, it } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "./app-error.js";
import {
  encodeBasicAuth,
  isAuthHeaderName,
  normalizeAuthPaste,
  recipeToMapping,
  serverAuthRecipeSchema,
} from "./mcp-auth-recipe.js";

describe("normalizeAuthPaste", () => {
  it("strips a leading Bearer prefix (case-insensitive)", () => {
    expect(normalizeAuthPaste("bearer", "Bearer sk_live_123")).toBe(
      "sk_live_123",
    );
    expect(normalizeAuthPaste("bearer", "bearer sk_live_123")).toBe(
      "sk_live_123",
    );
    expect(normalizeAuthPaste("bearer", "Token sk_live_123")).toBe(
      "sk_live_123",
    );
  });

  it("keeps the token when a header/query paste looks like Name: value", () => {
    expect(
      normalizeAuthPaste("header", "X-Shopify-Access-Token: shpat_123"),
    ).toBe("shpat_123");
    expect(normalizeAuthPaste("query", "api_key: secret")).toBe("secret");
  });
});

describe("isAuthHeaderName", () => {
  it("matches Shopify-style access-token header names", () => {
    expect(isAuthHeaderName("X-Shopify-Access-Token")).toBe(true);
    expect(isAuthHeaderName("X-API-Secret")).toBe(true);
    expect(isAuthHeaderName("Authorization")).toBe(true);
    expect(isAuthHeaderName("Accept")).toBe(false);
  });
});

describe("recipeToMapping", () => {
  it("encodes Basic as Base64(username:password)", () => {
    const mapping = recipeToMapping({
      type: "basic",
      username: "user",
      password: "pass",
    });
    expect(mapping.variableName).toBe("basic_auth");
    expect(mapping.plaintext).toBe(encodeBasicAuth("user", "pass"));
    expect(mapping.headerKeys).toEqual(["Authorization"]);
  });

  it("maps bearer with stripped prefix", () => {
    const mapping = recipeToMapping({
      type: "bearer",
      token: "Bearer sk_live_123",
    });
    expect(mapping).toMatchObject({
      variableName: "api_token",
      plaintext: "sk_live_123",
      headerKeys: ["Authorization"],
    });
  });

  it("rejects an empty bearer token", () => {
    expect(() => recipeToMapping({ type: "bearer", token: "   " })).toThrow(
      AppError,
    );
    try {
      recipeToMapping({ type: "bearer", token: "" });
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).appCode).toBe(APP_ERROR_CODES.INVALID_INPUT);
    }
  });

  it("slugs a Shopify header name for the variable", () => {
    const mapping = recipeToMapping({
      type: "header",
      headerName: "X-Shopify-Access-Token",
      value: "shpat_123",
    });
    expect(mapping.variableName).toBe("x_shopify_access_token");
    expect(mapping.headerKeys).toEqual(["X-Shopify-Access-Token"]);
  });
});

describe("serverAuthRecipeSchema", () => {
  it("accepts a query recipe with the exposure acknowledgement", () => {
    const parsed = serverAuthRecipeSchema.parse({
      type: "query",
      paramName: "api_key",
      value: "secret",
      queryExposureAcknowledged: true,
    });
    expect(parsed).toMatchObject({ queryExposureAcknowledged: true });
  });

  it("allows the acknowledgement to be omitted at the schema level", () => {
    const parsed = serverAuthRecipeSchema.parse({
      type: "query",
      paramName: "api_key",
      value: "secret",
    });
    expect(parsed.type).toBe("query");
  });
});
