import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "rmcp";
const DISPLAY_PREFIX_LENGTH = 12;

export type GeneratedAgentToken = {
  raw: string;
  hash: string;
  prefix: string;
};

export function hashAgentToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function generateAgentToken(): GeneratedAgentToken {
  const raw = `${TOKEN_PREFIX}_${randomBytes(32).toString("base64url")}`;
  return {
    raw,
    hash: hashAgentToken(raw),
    prefix: raw.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

export function verifyAgentToken(raw: string, hash: string): boolean {
  const computed = hashAgentToken(raw);
  const expected = Buffer.from(hash, "hex");
  const actual = Buffer.from(computed, "hex");
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}

export function extractBearerToken(
  header: string | null | undefined,
): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}
