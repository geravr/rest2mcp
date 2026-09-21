import { describe, expect, it } from "vitest";
import {
  AiCredentialEnvelopeError,
  type AiCredentialEnvelopeErrorCode,
  decryptAiCredential,
  encryptAiCredential,
  type AiCredentialIdentity,
} from "./ai-crypto.js";

const SECRET = "a".repeat(32);
const OTHER_SECRET = "b".repeat(32);
const PLAINTEXT = "sk-test-provider-key";
const IDENTITY: AiCredentialIdentity = {
  userId: "user-1",
  connectionId: "connection-1",
  providerKind: "openai",
};

function envelopeErrorCodeOf(
  run: () => unknown,
): AiCredentialEnvelopeErrorCode {
  try {
    run();
  } catch (error) {
    if (error instanceof AiCredentialEnvelopeError) {
      return error.code;
    }
    throw error;
  }
  throw new Error("Expected the call to throw AiCredentialEnvelopeError");
}

describe("ai-crypto", () => {
  it("round-trips a credential through the identity-bound envelope", () => {
    const envelope = encryptAiCredential(PLAINTEXT, IDENTITY, SECRET);

    expect(envelope).toMatch(
      /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    expect(envelope).not.toContain(PLAINTEXT);
    expect(decryptAiCredential(envelope, IDENTITY, SECRET)).toBe(PLAINTEXT);
  });

  it("produces different envelopes for the same plaintext and identity", () => {
    const first = encryptAiCredential(PLAINTEXT, IDENTITY, SECRET);
    const second = encryptAiCredential(PLAINTEXT, IDENTITY, SECRET);

    expect(first).not.toBe(second);
    expect(decryptAiCredential(first, IDENTITY, SECRET)).toBe(PLAINTEXT);
    expect(decryptAiCredential(second, IDENTITY, SECRET)).toBe(PLAINTEXT);
  });

  it("rejects malformed envelopes", () => {
    const envelope = encryptAiCredential(PLAINTEXT, IDENTITY, SECRET);
    const [, ivPart, tagPart, dataPart] = envelope.split(".");

    expect(
      envelopeErrorCodeOf(() =>
        decryptAiCredential("not-valid", IDENTITY, SECRET),
      ),
    ).toBe("malformed_envelope");
    expect(
      envelopeErrorCodeOf(() =>
        decryptAiCredential("v1.only-three-parts.x", IDENTITY, SECRET),
      ),
    ).toBe("malformed_envelope");
    expect(
      envelopeErrorCodeOf(() =>
        decryptAiCredential("v1..!!!!.!!!!", IDENTITY, SECRET),
      ),
    ).toBe("malformed_envelope");
    expect(
      envelopeErrorCodeOf(() =>
        decryptAiCredential("v1.a$b.!!!!.!!!!", IDENTITY, SECRET),
      ),
    ).toBe("malformed_envelope");
    expect(
      envelopeErrorCodeOf(() =>
        decryptAiCredential(
          `v1.${ivPart}.${tagPart}.${dataPart}extra`,
          IDENTITY,
          SECRET,
        ),
      ),
    ).toBe("authentication_failed");
  });

  it("rejects unknown envelope versions", () => {
    const envelope = encryptAiCredential(PLAINTEXT, IDENTITY, SECRET);
    const [, ivPart, tagPart, dataPart] = envelope.split(".");

    expect(
      envelopeErrorCodeOf(() =>
        decryptAiCredential(
          `v2.${ivPart}.${tagPart}.${dataPart}`,
          IDENTITY,
          SECRET,
        ),
      ),
    ).toBe("unsupported_version");
    expect(
      envelopeErrorCodeOf(() =>
        decryptAiCredential(
          `v10.${ivPart}.${tagPart}.${dataPart}`,
          IDENTITY,
          SECRET,
        ),
      ),
    ).toBe("unsupported_version");
    expect(
      envelopeErrorCodeOf(() =>
        decryptAiCredential(
          `w1.${ivPart}.${tagPart}.${dataPart}`,
          IDENTITY,
          SECRET,
        ),
      ),
    ).toBe("malformed_envelope");
  });

  it("fails closed under a wrong deployment secret", () => {
    const envelope = encryptAiCredential(PLAINTEXT, IDENTITY, SECRET);

    expect(
      envelopeErrorCodeOf(() =>
        decryptAiCredential(envelope, IDENTITY, OTHER_SECRET),
      ),
    ).toBe("authentication_failed");
  });

  it("rejects transplanted envelopes before any provider request could follow", () => {
    // This module depends only on node:crypto and performs no I/O: decryption
    // is a pure function whose AAD check throws before it can return a
    // plaintext, so no provider request can ever follow a transplant.
    const envelope = encryptAiCredential(PLAINTEXT, IDENTITY, SECRET);

    expect(
      envelopeErrorCodeOf(() =>
        decryptAiCredential(
          envelope,
          { ...IDENTITY, userId: "user-2" },
          SECRET,
        ),
      ),
    ).toBe("authentication_failed");
    expect(
      envelopeErrorCodeOf(() =>
        decryptAiCredential(
          envelope,
          { ...IDENTITY, connectionId: "connection-2" },
          SECRET,
        ),
      ),
    ).toBe("authentication_failed");
    expect(
      envelopeErrorCodeOf(() =>
        decryptAiCredential(
          envelope,
          { ...IDENTITY, providerKind: "anthropic" },
          SECRET,
        ),
      ),
    ).toBe("authentication_failed");
  });

  it("rejects empty and oversized plaintext", () => {
    expect(
      envelopeErrorCodeOf(() => encryptAiCredential("", IDENTITY, SECRET)),
    ).toBe("invalid_input");
    expect(
      envelopeErrorCodeOf(() =>
        encryptAiCredential("k".repeat(4097), IDENTITY, SECRET),
      ),
    ).toBe("invalid_input");

    const atCap = encryptAiCredential("k".repeat(4096), IDENTITY, SECRET);
    expect(decryptAiCredential(atCap, IDENTITY, SECRET)).toBe("k".repeat(4096));
  });

  it("rejects incomplete credential identities", () => {
    expect(
      envelopeErrorCodeOf(() =>
        encryptAiCredential(
          PLAINTEXT,
          { ...IDENTITY, providerKind: "" },
          SECRET,
        ),
      ),
    ).toBe("invalid_input");
  });

  it("never exposes the secret or plaintext in error messages", () => {
    const envelope = encryptAiCredential(PLAINTEXT, IDENTITY, SECRET);
    const messages: string[] = [];
    const failures = [
      () => decryptAiCredential(envelope, IDENTITY, OTHER_SECRET),
      () => decryptAiCredential("not-valid", IDENTITY, SECRET),
      () => encryptAiCredential("k".repeat(4097), IDENTITY, SECRET),
    ];

    for (const run of failures) {
      try {
        run();
      } catch (error) {
        if (!(error instanceof AiCredentialEnvelopeError)) throw error;
        messages.push(error.message);
      }
    }

    expect(messages.length).toBe(failures.length);
    for (const message of messages) {
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain(OTHER_SECRET);
      expect(message).not.toContain(PLAINTEXT);
      expect(message).not.toContain("k".repeat(4097));
    }
  });
});
