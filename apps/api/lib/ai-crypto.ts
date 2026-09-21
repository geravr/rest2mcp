import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const MAX_PLAINTEXT_LENGTH = 4096;
const ENVELOPE_VERSION = "1";
const ENVELOPE_PREFIX = `v${ENVELOPE_VERSION}`;
const VERSION_TOKEN_PATTERN = /^v\d+$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type AiCredentialIdentity = {
  userId: string;
  connectionId: string;
  providerKind: string;
};

export type AiCredentialEnvelopeErrorCode =
  | "malformed_envelope"
  | "unsupported_version"
  | "authentication_failed"
  | "invalid_input";

const ENVELOPE_ERROR_MESSAGES: Record<AiCredentialEnvelopeErrorCode, string> = {
  malformed_envelope: "AI credential envelope is malformed",
  unsupported_version: "AI credential envelope version is not supported",
  authentication_failed: "AI credential envelope authentication failed",
  invalid_input: "AI credential input is invalid",
};

export class AiCredentialEnvelopeError extends Error {
  readonly code: AiCredentialEnvelopeErrorCode;

  constructor(code: AiCredentialEnvelopeErrorCode) {
    super(ENVELOPE_ERROR_MESSAGES[code]);
    this.name = "AiCredentialEnvelopeError";
    this.code = code;
  }
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/**
 * AAD serialization contract: `JSON.stringify([envelopeVersion, userId,
 * connectionId, providerKind])` encoded utf8. JSON array encoding is
 * deterministic and unambiguous, so the AAD binds decryption to the exact
 * identity quadruple the credential was encrypted under.
 */
function buildAad(identity: AiCredentialIdentity): Buffer {
  return Buffer.from(
    JSON.stringify([
      ENVELOPE_VERSION,
      identity.userId,
      identity.connectionId,
      identity.providerKind,
    ]),
    "utf8",
  );
}

function assertUsableIdentity(identity: AiCredentialIdentity): void {
  if (
    typeof identity !== "object" ||
    identity === null ||
    typeof identity.userId !== "string" ||
    identity.userId.length === 0 ||
    typeof identity.connectionId !== "string" ||
    identity.connectionId.length === 0 ||
    typeof identity.providerKind !== "string" ||
    identity.providerKind.length === 0
  ) {
    throw new AiCredentialEnvelopeError("invalid_input");
  }
}

function assertUsableSecret(secret: string): void {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new AiCredentialEnvelopeError("invalid_input");
  }
}

function assertUsablePlaintext(plaintext: string): void {
  if (
    typeof plaintext !== "string" ||
    plaintext.length === 0 ||
    plaintext.length > MAX_PLAINTEXT_LENGTH
  ) {
    throw new AiCredentialEnvelopeError("invalid_input");
  }
}

function decodeEnvelopeSegment(
  segment: string,
  expectedLength: number,
): Buffer {
  if (!BASE64URL_PATTERN.test(segment)) {
    throw new AiCredentialEnvelopeError("malformed_envelope");
  }
  const decoded = Buffer.from(segment, "base64url");
  if (
    decoded.length !== expectedLength ||
    decoded.toString("base64url") !== segment
  ) {
    throw new AiCredentialEnvelopeError("malformed_envelope");
  }
  return decoded;
}

function decodeCiphertextSegment(segment: string): Buffer {
  if (!BASE64URL_PATTERN.test(segment)) {
    throw new AiCredentialEnvelopeError("malformed_envelope");
  }
  const decoded = Buffer.from(segment, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== segment) {
    throw new AiCredentialEnvelopeError("malformed_envelope");
  }
  return decoded;
}

export function encryptAiCredential(
  plaintext: string,
  identity: AiCredentialIdentity,
  secret: string,
): string {
  assertUsablePlaintext(plaintext);
  assertUsableIdentity(identity);
  assertUsableSecret(secret);

  const key = deriveKey(secret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  cipher.setAAD(buildAad(identity));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    ENVELOPE_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptAiCredential(
  envelope: string,
  identity: AiCredentialIdentity,
  secret: string,
): string {
  assertUsableIdentity(identity);
  assertUsableSecret(secret);

  if (typeof envelope !== "string") {
    throw new AiCredentialEnvelopeError("malformed_envelope");
  }
  const parts = envelope.split(".");
  if (parts.length !== 4) {
    throw new AiCredentialEnvelopeError("malformed_envelope");
  }
  const [versionToken, ivPart, tagPart, dataPart] = parts;
  if (VERSION_TOKEN_PATTERN.test(versionToken)) {
    if (versionToken !== ENVELOPE_PREFIX) {
      throw new AiCredentialEnvelopeError("unsupported_version");
    }
  } else {
    throw new AiCredentialEnvelopeError("malformed_envelope");
  }

  const iv = decodeEnvelopeSegment(ivPart, IV_LENGTH);
  const tag = decodeEnvelopeSegment(tagPart, AUTH_TAG_LENGTH);
  const ciphertext = decodeCiphertextSegment(dataPart);

  try {
    const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAAD(buildAad(identity));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AiCredentialEnvelopeError("authentication_failed");
  }
}
