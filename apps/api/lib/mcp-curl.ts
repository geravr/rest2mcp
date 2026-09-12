import { APP_ERROR_CODES, appError } from "./app-error.js";

export type ParsedCurl = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  credentialSuggestion: {
    scheme: "bearer" | "api_key" | "header";
    headerName: string | null;
    valueLocation: "header" | "query";
  } | null;
};

const AUTH_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-apikey",
  "api-key",
  "apikey",
  "x-auth-token",
  "x-access-token",
]);

function isAuthHeaderName(name: string): boolean {
  const normalized = name.toLowerCase();
  if (AUTH_HEADER_NAMES.has(normalized)) return true;
  return /api[-_]?key/i.test(normalized);
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

function tokenizeCurl(command: string): string[] {
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
    throw appError({
      appCode: APP_ERROR_CODES.MCP_CURL_INVALID,
      message: "Unclosed quote in curl command.",
      status: 400,
    });
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
    return { value: inlineValue, nextIndex: index + 1 };
  }
  const next = tokens[index + 1];
  if (!next || next.startsWith("-")) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_CURL_INVALID,
      message: "Curl flag is missing a value.",
      status: 400,
    });
  }
  return { value: next, nextIndex: index + 2 };
}

function parseHeader(raw: string): { name: string; value: string } | null {
  const separator = raw.indexOf(":");
  if (separator <= 0) return null;
  return {
    name: raw.slice(0, separator).trim(),
    value: raw.slice(separator + 1).trim(),
  };
}

function inferCredentialSuggestion(
  headers: Record<string, string>,
): ParsedCurl["credentialSuggestion"] {
  for (const [name, value] of Object.entries(headers)) {
    if (!isAuthHeaderName(name)) continue;
    const bearer = value.match(/^Bearer\s+(\S+)/i);
    if (bearer) {
      return {
        scheme: "bearer",
        headerName: "Authorization",
        valueLocation: "header",
      };
    }
    if (/api[-_]?key/i.test(name)) {
      return {
        scheme: "api_key",
        headerName: name,
        valueLocation: "header",
      };
    }
    return {
      scheme: "header",
      headerName: name,
      valueLocation: "header",
    };
  }
  return null;
}

export function parseCurlCommand(command: string): ParsedCurl {
  const trimmed = command.trim().replace(/\\\n/g, " ");
  if (!trimmed) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_CURL_INVALID,
      message: "Curl command is empty.",
      status: 400,
    });
  }

  const tokens = tokenizeCurl(trimmed);
  if (tokens[0] !== "curl") {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_CURL_INVALID,
      message: "Command must start with curl.",
      status: 400,
    });
  }

  let method: string | null = null;
  let url: string | null = null;
  let body: string | null = null;
  const rawHeaders: Record<string, string> = {};

  for (let index = 1; index < tokens.length;) {
    const token = tokens[index];

    if (!token.startsWith("-") && !url) {
      url = token;
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
      if (header) {
        rawHeaders[header.name] = header.value;
      }
      index = consumed.nextIndex;
      continue;
    }

    if (
      flag === "-d" ||
      flag === "--data" ||
      flag === "--data-raw" ||
      flag === "--data-binary" ||
      flag === "--data-ascii"
    ) {
      const consumed = consumeFlagValue(tokens, index, inline);
      body = consumed.value;
      if (!method) method = "POST";
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

    if (flag.startsWith("-")) {
      if (
        flag === "-s" ||
        flag === "--silent" ||
        flag === "-L" ||
        flag === "--location" ||
        flag === "-k" ||
        flag === "--insecure" ||
        flag === "-v" ||
        flag === "--verbose" ||
        flag === "-i" ||
        flag === "--include"
      ) {
        index += 1;
        continue;
      }
      if (tokens[index + 1] && !tokens[index + 1].startsWith("-") && !url) {
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (!url) {
      url = token;
    }
    index += 1;
  }

  if (!url) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_CURL_INVALID,
      message: "Curl command is missing a URL.",
      status: 400,
    });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(stripQuotes(url));
  } catch {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_CURL_INVALID,
      message: "Curl URL is invalid.",
      status: 400,
    });
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_CURL_INVALID,
      message: "Curl URL must be http or https.",
      status: 400,
    });
  }

  const credentialSuggestion = inferCredentialSuggestion(rawHeaders);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawHeaders)) {
    if (isAuthHeaderName(name)) continue;
    headers[name] = value;
  }

  return {
    method: method ?? "GET",
    url: parsedUrl.toString(),
    headers,
    body,
    credentialSuggestion,
  };
}

export function isSafeToolHeaderName(name: string): boolean {
  return !isAuthHeaderName(name);
}
