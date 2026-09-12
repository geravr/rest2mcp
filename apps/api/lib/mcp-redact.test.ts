import { describe, expect, it } from "vitest";
import { redactText, summarizeForLog } from "./mcp-redact.js";

describe("mcp-redact", () => {
  it("redacts bearer tokens and explicit secrets", () => {
    const text = 'Authorization: Bearer super-secret\nbody: {"ok":true}';
    const redacted = redactText(text, ["super-secret"]);

    expect(redacted).not.toContain("super-secret");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts URL-encoded query secrets", () => {
    const secret = "a+b=c&d";
    const url = `https://api.example.com/v1?X-API-Key=${encodeURIComponent(secret)}`;
    const redacted = redactText(url, [secret]);

    expect(redacted).not.toContain(secret);
    expect(redacted).not.toContain(encodeURIComponent(secret));
    expect(redacted).toContain("[REDACTED]");
  });

  it("caps log summaries at 64 KiB after redaction", () => {
    const secret = "abc-credential";
    const summary = summarizeForLog(`${"x".repeat(70_000)} ${secret}`, [
      secret,
    ]);

    expect(summary.length).toBeLessThanOrEqual(64 * 1024);
    expect(summary).not.toContain(secret);
  });
});
