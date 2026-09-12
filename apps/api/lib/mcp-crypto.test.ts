import { describe, expect, it } from "vitest";
import { decryptCredential, encryptCredential } from "./mcp-crypto.js";

const SECRET = "a".repeat(32);
const OTHER_SECRET = "b".repeat(32);

describe("mcp-crypto", () => {
  it("round-trips a credential secret", () => {
    const ciphertext = encryptCredential("abc", SECRET);

    expect(ciphertext).not.toContain("abc");
    expect(decryptCredential(ciphertext, SECRET)).toBe("abc");
  });

  it("produces different ciphertext for the same plaintext", () => {
    const first = encryptCredential("abc", SECRET);
    const second = encryptCredential("abc", SECRET);

    expect(first).not.toBe(second);
    expect(decryptCredential(first, SECRET)).toBe("abc");
    expect(decryptCredential(second, SECRET)).toBe("abc");
  });

  it("rejects the wrong secret", () => {
    const ciphertext = encryptCredential("abc", SECRET);

    expect(() => decryptCredential(ciphertext, OTHER_SECRET)).toThrow();
  });

  it("rejects malformed ciphertext", () => {
    expect(() => decryptCredential("not-valid", SECRET)).toThrow(
      "Invalid credential ciphertext",
    );
    expect(() => decryptCredential("a.b", SECRET)).toThrow(
      "Invalid credential ciphertext",
    );
  });
});
