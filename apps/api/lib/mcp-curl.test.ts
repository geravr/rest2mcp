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
    expect(parsed.url.toString()).toBe("https://api.example.com/v1/items");
    expect(parsed.headers).toEqual([
      { name: "Accept", value: "application/json" },
    ]);
    expect(parsed.body).toBeNull();
    expect(parsed.credentials).toEqual([]);
  });

  it("parses POST data and pulls Authorization out as a credential", () => {
    const parsed = parseCurlCommand(
      `curl -X POST -H 'Authorization: Bearer secret-token' -H 'Content-Type: application/json' --data '{"name":"foo"}' https://api.example.com/v1/items`,
    );

    expect(parsed.method).toBe("POST");
    expect(parsed.body).toBe('{"name":"foo"}');
    expect(parsed.headers).toEqual([
      { name: "Content-Type", value: "application/json" },
    ]);
    expect(JSON.stringify(parsed.headers)).not.toContain("secret-token");
    expect(parsed.credentials).toEqual([
      { kind: "bearer", headerName: "Authorization", value: "secret-token" },
    ]);
  });

  it("treats api-key headers as a credential, not a tool header", () => {
    const parsed = parseCurlCommand(
      `curl -H 'X-API-Key: super-secret' https://api.example.com/v1/items`,
    );

    expect(parsed.headers).toEqual([]);
    expect(parsed.credentials).toEqual([
      { kind: "api_key", headerName: "X-API-Key", value: "super-secret" },
    ]);
  });

  it("excludes cookies as a credential and never adds a Cookie header", () => {
    const parsed = parseCurlCommand(
      `curl -b 'session=abc123' https://api.example.com/v1/items`,
    );

    expect(parsed.headers).toEqual([]);
    expect(parsed.credentials).toEqual([
      { kind: "cookie", headerName: "Cookie", value: "session=abc123" },
    ]);
  });

  it("encodes -u/--user as a basic auth credential", () => {
    const parsed = parseCurlCommand(
      `curl -u alice:s3cret https://api.example.com/v1/items`,
    );

    expect(parsed.credentials).toHaveLength(1);
    expect(parsed.credentials[0].kind).toBe("basic");
    expect(parsed.credentials[0].headerName).toBe("Authorization");
    expect(parsed.credentials[0].value).toBe(
      Buffer.from("alice:s3cret", "utf8").toString("base64"),
    );
  });

  it("excludes forbidden transport headers by name only", () => {
    const parsed = parseCurlCommand(
      `curl -H 'Host: evil.example.com' -H 'Accept: application/json' https://api.example.com/v1/items`,
    );

    expect(parsed.headers).toEqual([
      { name: "Accept", value: "application/json" },
    ]);
    expect(parsed.excludedTransportHeaders).toEqual(["Host"]);
  });

  it("rejects unsupported request-affecting flags by name", () => {
    expect(() =>
      parseCurlCommand(`curl -F 'file=@photo.png' https://api.example.com`),
    ).toThrow(AppError);
    try {
      parseCurlCommand(`curl -F 'file=@photo.png' https://api.example.com`);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).appCode).toBe(
        APP_ERROR_CODES.MCP_CURL_INVALID,
      );
      expect((error as AppError).message).toContain("-F");
    }
  });

  it("ignores cosmetic/output flags that do not affect the request", () => {
    const parsed = parseCurlCommand(
      `curl -s -L -o out.json https://api.example.com/v1/items`,
    );
    expect(parsed.method).toBe("GET");
    expect(parsed.url.toString()).toBe("https://api.example.com/v1/items");
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
