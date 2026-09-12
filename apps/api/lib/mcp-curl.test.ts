import { describe, expect, it } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "./app-error.js";
import { parseCurlCommand } from "./mcp-curl.js";

describe("parseCurlCommand", () => {
  it("parses a GET curl with method, URL, and non-auth headers", () => {
    const parsed = parseCurlCommand(
      `curl -H 'Accept: application/json' https://api.example.com/v1/items`,
    );

    expect(parsed.method).toBe("GET");
    expect(parsed.url).toBe("https://api.example.com/v1/items");
    expect(parsed.headers).toEqual({ Accept: "application/json" });
    expect(parsed.body).toBeNull();
    expect(parsed.credentialSuggestion).toBeNull();
  });

  it("parses POST data and strips Authorization from tool headers", () => {
    const parsed = parseCurlCommand(
      `curl -X POST -H 'Authorization: Bearer secret-token' -H 'Content-Type: application/json' --data '{"name":"foo"}' https://api.example.com/v1/items`,
    );

    expect(parsed.method).toBe("POST");
    expect(parsed.body).toBe('{"name":"foo"}');
    expect(parsed.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.stringify(parsed)).not.toContain("secret-token");
    expect(parsed.credentialSuggestion).toEqual({
      scheme: "bearer",
      headerName: "Authorization",
      valueLocation: "header",
    });
  });

  it("treats api-key headers as a credential suggestion, not a tool header", () => {
    const parsed = parseCurlCommand(
      `curl -H 'X-API-Key: super-secret' https://api.example.com/v1/items`,
    );

    expect(parsed.headers).toEqual({});
    expect(parsed.credentialSuggestion?.scheme).toBe("api_key");
    expect(JSON.stringify(parsed.headers)).not.toContain("super-secret");
  });

  it("rejects strings that are not parseable curl commands", () => {
    const invalid = ["", "wget https://example.com", "curl", "not a command"];

    for (const command of invalid) {
      expect(() => parseCurlCommand(command)).toThrow(AppError);
      try {
        parseCurlCommand(command);
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).appCode).toBe(
          APP_ERROR_CODES.MCP_CURL_INVALID,
        );
      }
    }
  });
});
