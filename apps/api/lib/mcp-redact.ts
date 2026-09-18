import {
  MCP_RESPONSE_BYTE_LIMIT,
  MCP_UPSTREAM_DEADLINE_MS,
} from "./mcp-policy.js";

const LOG_SUMMARY_LIMIT = 64 * 1024;
/** Kept as an alias so existing callers do not need to migrate imports. */
export const MCP_RESPONSE_LIMIT = MCP_RESPONSE_BYTE_LIMIT;
/** Kept as an alias so existing callers do not need to migrate imports. */
export const MCP_UPSTREAM_TIMEOUT_MS = MCP_UPSTREAM_DEADLINE_MS;
export const MCP_MAX_TOOLS_PER_SERVER = 50;

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /(?<=(?:api[_-]?key|authorization|token|secret)\s*[:=]\s*)\S+/gi,
];

function secretVariants(secret: string): string[] {
  const encoded = encodeURIComponent(secret);
  const formEncoded = encoded.replace(/%20/g, "+");
  return [...new Set([secret, encoded, formEncoded])];
}

export function redactText(value: string, secrets: string[] = []): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    for (const variant of secretVariants(secret)) {
      redacted = redacted.split(variant).join("[REDACTED]");
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

export function capText(
  value: string,
  limit: number,
): {
  text: string;
  truncated: boolean;
} {
  if (value.length <= limit) {
    return { text: value, truncated: false };
  }
  return { text: value.slice(0, limit), truncated: true };
}

export function summarizeForLog(value: string, secrets: string[] = []): string {
  return capText(redactText(value, secrets), LOG_SUMMARY_LIMIT).text;
}

export function capResponseBody(value: string): {
  text: string;
  truncated: boolean;
} {
  return capText(value, MCP_RESPONSE_LIMIT);
}
