/**
 * @file Side-effect-free curl tokenizer with an explicit supported-flag
 * allowlist. Ambiguous or unsupported request-affecting flags are rejected
 * rather than silently ignored. Credential-shaped headers, cookies, proxy
 * credentials, and unsafe transport headers are pulled out of the plain
 * header list and reported only by kind/name — never surfaced as tool
 * headers — so downstream importers cannot accidentally persist a secret.
 */
import { encodeBasicAuth, isAuthHeaderName } from "./mcp-auth-recipe.js";
import { APP_ERROR_CODES, appError } from "./app-error.js";
import { isForbiddenTransportHeaderName } from "./mcp-policy.js";

export { isAuthHeaderName };

export type CurlCredentialKind =
  "bearer" | "basic" | "api_key" | "header" | "cookie" | "proxy";

export type CurlCredential = {
  kind: CurlCredentialKind;
  /** Header name the credential would occupy ("Authorization", "Cookie", ...). */
  headerName: string;
  /** Raw secret value, retained only for internal detection — never serialized. */
  value: string;
};

export type ParsedCurl = {
  method: string;
  url: URL;
  /** Ordered, non-credential, non-forbidden headers (duplicates preserved). */
  headers: Array<{ name: string; value: string }>;
  body: string | null;
  credentials: CurlCredential[];
  /** Names only, e.g. "Host" — excluded because they are transport-reserved. */
  excludedTransportHeaders: string[];
};

function invalidCurl(message: string): never {
  throw appError({
    appCode: APP_ERROR_CODES.MCP_CURL_INVALID,
    message,
    status: 400,
  });
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function tokenizeCurl(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (quote) {
    invalidCurl("Unclosed quote in curl command.");
  }
  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function consumeFlagValue(
  tokens: string[],
  index: number,
  inlineValue: string | undefined,
): { value: string; nextIndex: number } {
  if (inlineValue !== undefined && inlineValue.length > 0) {
    return { value: stripQuotes(inlineValue), nextIndex: index + 1 };
  }
  const next = tokens[index + 1];
  if (next === undefined || next.startsWith("-")) {
    invalidCurl("Curl flag is missing a value.");
  }
  return { value: stripQuotes(next), nextIndex: index + 2 };
}

function parseHeader(raw: string): { name: string; value: string } | null {
  const separator = raw.indexOf(":");
  if (separator <= 0) return null;
  return {
    name: raw.slice(0, separator).trim(),
    value: raw.slice(separator + 1).trim(),
  };
}

/** Flags that take a value and change the outgoing request. */
const REQUEST_VALUE_FLAGS = new Set([
  "-X",
  "--request",
  "-H",
  "--header",
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-ascii",
  "--data-urlencode",
  "--url",
  "-u",
  "--user",
  "-b",
  "--cookie",
  "-A",
  "--user-agent",
  "-e",
  "--referer",
]);

/** Flags that take a value but do not affect the request as sent. */
const IGNORED_VALUE_FLAGS = new Set([
  "-o",
  "--output",
  "-w",
  "--write-out",
  "--cookie-jar",
  "--connect-timeout",
  "--max-time",
  "--retry",
  "--limit-rate",
  "-C",
  "--continue-at",
]);

/** Boolean flags that are safe to ignore for request-definition purposes. */
const IGNORED_BOOLEAN_FLAGS = new Set([
  "-s",
  "--silent",
  "-S",
  "--show-error",
  "-v",
  "--verbose",
  "-i",
  "--include",
  "-L",
  "--location",
  "-k",
  "--insecure",
  "--compressed",
  "-#",
  "--progress-bar",
  "-f",
  "--fail",
  "-N",
  "--no-buffer",
  "--http1.1",
  "--http2",
]);

function classifyHeaderCredential(name: string, value: string): CurlCredential {
  const bearer = value.match(/^Bearer\s+(\S+)/i);
  if (bearer && name.toLowerCase() === "authorization") {
    return { kind: "bearer", headerName: "Authorization", value: bearer[1] };
  }
  if (/api[-_]?key/i.test(name)) {
    return { kind: "api_key", headerName: name, value };
  }
  return { kind: "header", headerName: name, value };
}

export function parseCurlCommand(command: string): ParsedCurl {
  const trimmed = command.trim().replace(/\\\n/g, " ");
  if (!trimmed) {
    invalidCurl("Curl command is empty.");
  }

  const tokens = tokenizeCurl(trimmed);
  if (tokens[0] !== "curl") {
    invalidCurl("Command must start with curl.");
  }

  let method: string | null = null;
  let url: string | null = null;
  let body: string | null = null;
  const headers: Array<{ name: string; value: string }> = [];
  const credentials: CurlCredential[] = [];
  const excludedTransportHeaders: string[] = [];

  const pushHeader = (name: string, value: string): void => {
    const lower = name.toLowerCase();
    if (lower === "cookie") {
      credentials.push({ kind: "cookie", headerName: "Cookie", value });
      return;
    }
    if (isForbiddenTransportHeaderName(lower)) {
      if (lower.startsWith("proxy-")) {
        credentials.push({ kind: "proxy", headerName: name, value });
      } else {
        excludedTransportHeaders.push(name);
      }
      return;
    }
    if (isAuthHeaderName(name)) {
      credentials.push(classifyHeaderCredential(name, value));
      return;
    }
    headers.push({ name, value });
  };

  for (let index = 1; index < tokens.length;) {
    const token = tokens[index];

    if (!token.startsWith("-") && !url) {
      url = stripQuotes(token);
      index += 1;
      continue;
    }

    const [flag, inline] = token.split("=", 2);

    if (flag === "-X" || flag === "--request") {
      const consumed = consumeFlagValue(tokens, index, inline);
      method = consumed.value.toUpperCase();
      index = consumed.nextIndex;
      continue;
    }

    if (flag === "-H" || flag === "--header") {
      const consumed = consumeFlagValue(tokens, index, inline);
      const header = parseHeader(consumed.value);
      if (header) pushHeader(header.name, header.value);
      index = consumed.nextIndex;
      continue;
    }

    if (
      flag === "-d" ||
      flag === "--data" ||
      flag === "--data-raw" ||
      flag === "--data-binary" ||
      flag === "--data-ascii" ||
      flag === "--data-urlencode"
    ) {
      const consumed = consumeFlagValue(tokens, index, inline);
      body = consumed.value;
      if (!method) method = "POST";
      index = consumed.nextIndex;
      continue;
    }

    if (flag === "-u" || flag === "--user") {
      const consumed = consumeFlagValue(tokens, index, inline);
      const separator = consumed.value.indexOf(":");
      const username =
        separator >= 0 ? consumed.value.slice(0, separator) : consumed.value;
      const password =
        separator >= 0 ? consumed.value.slice(separator + 1) : "";
      credentials.push({
        kind: "basic",
        headerName: "Authorization",
        value: encodeBasicAuth(username, password),
      });
      index = consumed.nextIndex;
      continue;
    }

    if (flag === "-b" || flag === "--cookie") {
      const consumed = consumeFlagValue(tokens, index, inline);
      credentials.push({
        kind: "cookie",
        headerName: "Cookie",
        value: consumed.value,
      });
      index = consumed.nextIndex;
      continue;
    }

    if (flag === "-A" || flag === "--user-agent") {
      const consumed = consumeFlagValue(tokens, index, inline);
      pushHeader("User-Agent", consumed.value);
      index = consumed.nextIndex;
      continue;
    }

    if (flag === "-e" || flag === "--referer") {
      const consumed = consumeFlagValue(tokens, index, inline);
      pushHeader("Referer", consumed.value);
      index = consumed.nextIndex;
      continue;
    }

    if (flag === "-G" || flag === "--get") {
      method = "GET";
      index += 1;
      continue;
    }

    if (flag === "-I" || flag === "--head") {
      method = "HEAD";
      index += 1;
      continue;
    }

    if (flag === "--url") {
      const consumed = consumeFlagValue(tokens, index, inline);
      url = consumed.value;
      index = consumed.nextIndex;
      continue;
    }

    if (IGNORED_VALUE_FLAGS.has(flag)) {
      const consumed = consumeFlagValue(tokens, index, inline);
      index = consumed.nextIndex;
      continue;
    }

    if (IGNORED_BOOLEAN_FLAGS.has(flag)) {
      index += 1;
      continue;
    }

    if (REQUEST_VALUE_FLAGS.has(flag)) {
      // Unreachable: every request-affecting value flag is handled above.
      // Kept so adding a flag to the allowlist without a handler fails loudly.
      invalidCurl(`Curl flag "${flag}" is recognized but not implemented.`);
    }

    if (token.startsWith("-")) {
      invalidCurl(`Unsupported curl flag "${flag}".`);
    }

    if (!url) {
      url = stripQuotes(token);
    } else {
      invalidCurl("Curl command has more than one URL argument.");
    }
    index += 1;
  }

  if (!url) {
    invalidCurl("Curl command is missing a URL.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    invalidCurl("Curl URL is invalid.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    invalidCurl("Curl URL must be http or https.");
  }

  return {
    method: method ?? "GET",
    url: parsedUrl,
    headers,
    body,
    credentials,
    excludedTransportHeaders,
  };
}
