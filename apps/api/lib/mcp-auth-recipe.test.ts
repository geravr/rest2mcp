import { describe, expect, it } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "./app-error.js";
import {
  encodeBasicAuth,
  inferServerAuth,
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
    expect(mapping.defaultHeadersPatch).toEqual({
      Authorization: "Basic {{basic_auth}}",
    });
  });

  it("maps bearer with stripped prefix", () => {
    const mapping = recipeToMapping({
      type: "bearer",
      token: "Bearer sk_live_123",
    });
    expect(mapping).toMatchObject({
      variableName: "api_token",
      plaintext: "sk_live_123",
      defaultHeadersPatch: {
        Authorization: "Bearer {{api_token}}",
      },
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
    expect(mapping.defaultHeadersPatch).toEqual({
      "X-Shopify-Access-Token": "{{x_shopify_access_token}}",
    });
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

describe("inferServerAuth", () => {
  it("returns None when defaults are empty", () => {
    expect(inferServerAuth({}, {})).toEqual({ type: "none" });
    expect(inferServerAuth(null, null)).toEqual({ type: "none" });
  });

  it("infers Bearer from Authorization + api_token", () => {
    expect(
      inferServerAuth({ Authorization: "Bearer {{api_token}}" }, {}),
    ).toEqual({ type: "bearer", variableName: "api_token" });
  });

  it("returns Custom when two credential defaults exist", () => {
    expect(
      inferServerAuth(
        {
          Authorization: "Bearer {{api_token}}",
          "X-Partner-Key": "{{partner}}",
        },
        {},
      ),
    ).toEqual({ type: "custom" });
  });

  it("infers Basic from Authorization Basic template", () => {
    expect(
      inferServerAuth({ Authorization: "Basic {{basic_auth}}" }, {}),
    ).toEqual({ type: "basic", variableName: "basic_auth" });
  });

  it("infers query auth from a sole credential param", () => {
    expect(inferServerAuth({}, { api_key: "{{api_key}}" })).toEqual({
      type: "query",
      paramName: "api_key",
      variableName: "api_key",
    });
  });

  it("infers header auth from a sole templated API key header", () => {
    expect(inferServerAuth({ "X-API-Key": "{{api_key}}" }, {})).toEqual({
      type: "header",
      headerName: "X-API-Key",
      variableName: "api_key",
    });
  });
});
