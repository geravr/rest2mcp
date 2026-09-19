/**
 * @file Credential-safe removal of OpenAPI example/default material before it
 * can reach a canonical request definition or a preview response. Position
 * detection compares whole name segments and declared formats; value detection
 * combines fixed vendor shapes with assignment-shaped text. Substring name
 * matching is deliberately not used for these decisions.
 */

type JsonRecord = Record<string, unknown>;

/** Placeholder that keeps redacted document text readable. */
export const REDACTION_PLACEHOLDER = "[REDACTED]";

/**
 * Value-shape patterns for credentials with an unambiguous grammar (bearer
 * schemes, JWTs, PEM private keys) or a vendor-prefixed key. Each pattern has a
 * realistic non-secret control pinned in `openapi-redact.test.ts`.
 */
const CREDENTIAL_VALUE_PATTERNS = [
  // A bearer value needs 20+ characters and a digit, so prose such as
  // "Bearer authentication is required" survives.
  /\bbearer\s+(?=[A-Za-z0-9._~+/=-]*[0-9])[A-Za-z0-9._~+/=-]{20,}/i,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/,
  // A long base64 secret mixes letter case; a single-case hex digest, ULID,
  // UUID, or ETag is an identifier, not a secret.
  /(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])[A-Za-z0-9+/]{40,}={0,2}/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_]{8,}/i,
  /\bsk-proj-[A-Za-z0-9_-]{20,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/,
  /\bnpm_[A-Za-z0-9]{30,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bxapp-[A-Za-z0-9-]{20,}/,
  /\bhf_[A-Za-z0-9]{30,}/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
  /\b(?:api[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|client[-_]?secret|secret[-_]?key|private[-_]?key)[-_:][A-Za-z0-9+/_.=-]{8,}/i,
] as const;

const GLOBAL_CREDENTIAL_VALUE_PATTERNS = CREDENTIAL_VALUE_PATTERNS.map(
  (pattern) => new RegExp(pattern.source, `${pattern.flags}g`),
);

/**
 * Credential terms for assignment-shaped text, expressed as regex alternation
 * bodies. Longer and separator-tolerant forms come first so `passphrase`,
 * `password`, and `passwd` win over `pass`.
 */
const CREDENTIAL_ASSIGNMENT_TERMS = [
  "api[-_]?key",
  "access[-_]?token",
  "refresh[-_]?token",
  "session[-_]?token",
  "session[-_]?id",
  "auth[-_]?token",
  "auth[-_]?key",
  "client[-_]?secret",
  "secret[-_]?key",
  "private[-_]?key",
  "set[-_]?cookie",
  "otp[-_]?code",
  "authorization",
  "credentials?",
  "passphrase",
  "password",
  "passwd",
  "authcode",
  "bearer",
  "secret",
  "token",
  "otp",
  "jwt",
  "totp",
  "pwd",
  "pass",
  "auth",
  "cookie",
  "signature",
].join("|");

/**
 * One assignment shape. The case-insensitive match cannot express "mixed
 * case", so the captured value is confirmed by `hasSecretEvidence`; that check
 * is what keeps `api_key: string`, `token: number`, `password: string`,
 * `secret: required`, and `authorization: configured` intact.
 */
type CredentialTextPattern = {
  readonly pattern: RegExp;
  /** Index of the capture group holding the candidate value. */
  readonly valueGroup: number;
};

const CREDENTIAL_TEXT_PATTERNS: readonly CredentialTextPattern[] = [
  {
    pattern: new RegExp(
      `(?<![A-Za-z0-9])["']?(?:${CREDENTIAL_ASSIGNMENT_TERMS})["']?\\s*(?:=>|=|:)\\s*["']?(?:(?:Basic|Bearer)\\s+)?([A-Za-z0-9+/_.~=:-]{12,})["']?`,
      "i",
    ),
    valueGroup: 1,
  },
  {
    pattern: new RegExp(
      `<(\\s*(?:${CREDENTIAL_ASSIGNMENT_TERMS})\\s*)>\\s*([A-Za-z0-9+/_.~=:-]{12,})\\s*</\\1>`,
      "i",
    ),
    valueGroup: 2,
  },
];

const GLOBAL_CREDENTIAL_TEXT_PATTERNS = CREDENTIAL_TEXT_PATTERNS.map(
  ({ pattern, valueGroup }) => ({
    pattern: new RegExp(pattern.source, `${pattern.flags}g`),
    valueGroup,
  }),
);

/**
 * Whether a candidate assignment value carries evidence of a secret rather
 * than of a type or a word: at least one digit or base64/URL symbol, or both
 * letter cases. Single-case filler such as `paginationcursor` fails it.
 */
function hasSecretEvidence(value: string): boolean {
  return (
    /[0-9+/_.~=:-]/.test(value) || (/[A-Z]/.test(value) && /[a-z]/.test(value))
  );
}

/**
 * Credential-bearing name terms, compared per segment (or per joined adjacent
 * pair, so `api` + `key` and `session` + `id` count): `token`, `jwt`, `pwd`,
 * and `auth` are credentials, while `key`, `session`, and `author` are not.
 */
const CREDENTIAL_NAME_TERMS = new Set([
  "apikey",
  "auth",
  "authcode",
  "authkey",
  "authorization",
  "bearer",
  "credential",
  "credentials",
  "cookie",
  "jwt",
  "otp",
  "pass",
  "passphrase",
  "password",
  "passwd",
  "pwd",
  "secret",
  "sessionid",
  "signature",
  "token",
  "totp",
  // Joined adjacent pairs.
  "accesstoken",
  "authtoken",
  "clientsecret",
  "privatekey",
  "refreshtoken",
  "secretkey",
  "sessiontoken",
  "setcookie",
]);

/**
 * Segments that turn the credential term they follow into metadata about a
 * credential: `token_count`, `signature_version`, `private_key_id`,
 * `access_token_ttl`, and `cookie_consent` are ordinary names. Only segments
 * after the matched evidence disqualify, so leading qualifiers such as
 * `id_token` and `x_api_key` still count. `hash` is deliberately absent:
 * `password_hash`, `api_key_hash`, and `session_token_hash` are credential
 * material that must not be persisted.
 */
const DISQUALIFYING_NAME_SEGMENTS = new Set([
  "algorithm",
  "at",
  "consent",
  "count",
  "enabled",
  "endpoint",
  "expires",
  "expiry",
  "flag",
  "format",
  "hint",
  "id",
  "kind",
  "label",
  "length",
  "list",
  "map",
  "mode",
  "name",
  "placeholder",
  "policy",
  "prefix",
  "required",
  "schema",
  "set",
  "size",
  "spec",
  "status",
  "supported",
  "suffix",
  "ttl",
  "type",
  "uri",
  "url",
  "version",
]);

const SCHEMA_LIST_KEYWORDS = [
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems",
] as const;
const SCHEMA_MAP_KEYWORDS = ["properties", "patternProperties"] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitNameSegments(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((segment) => segment.length > 0);
}

function disqualifiesAfter(
  segments: readonly string[],
  start: number,
): boolean {
  for (let index = start; index < segments.length; index += 1) {
    if (DISQUALIFYING_NAME_SEGMENTS.has(segments[index] ?? "")) return true;
  }
  return false;
}

/**
 * Whether a position name marks credential-bearing data: some segment is a
 * credential term (or a joined adjacent pair is), and no later segment merely
 * qualifies it. A trailing qualifier disqualifies (`private_key_id`,
 * `signature_version`), a leading one does not (`id_token`, `x_api_key`).
 */
export function isCredentialPositionName(name: string): boolean {
  const segments = splitNameSegments(name);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? "";
    if (
      CREDENTIAL_NAME_TERMS.has(segment) &&
      !disqualifiesAfter(segments, index + 1)
    ) {
      return true;
    }
    const next = segments[index + 1];
    if (
      next !== undefined &&
      CREDENTIAL_NAME_TERMS.has(`${segment}${next}`) &&
      !disqualifiesAfter(segments, index + 2)
    ) {
      return true;
    }
  }
  return false;
}

function hasSecretAssignment(
  pattern: CredentialTextPattern,
  text: string,
): boolean {
  const match = pattern.pattern.exec(text);
  const value: string | undefined = match?.[pattern.valueGroup];
  return value !== undefined && hasSecretEvidence(value);
}

/** Whether any string inside the value looks like a token, JWT, or secret assignment. */
export function isCredentialLikeValue(value: unknown): boolean {
  if (typeof value === "string") {
    return (
      CREDENTIAL_VALUE_PATTERNS.some((pattern) => pattern.test(value)) ||
      CREDENTIAL_TEXT_PATTERNS.some((pattern) =>
        hasSecretAssignment(pattern, value),
      )
    );
  }
  if (Array.isArray(value)) {
    return value.some((item) => isCredentialLikeValue(item));
  }
  if (isRecord(value)) {
    return Object.values(value).some((item) => isCredentialLikeValue(item));
  }
  return false;
}

/**
 * Replaces credential-shaped spans with a neutral placeholder so document text
 * stays readable. Value-shape based only: prose that merely names a credential
 * ("authentication", "the API key header") is left intact.
 */
export function redactCredentialText(text: string): {
  text: string;
  redacted: boolean;
} {
  let redactedText = text;
  for (const pattern of GLOBAL_CREDENTIAL_VALUE_PATTERNS) {
    redactedText = redactedText.replace(pattern, REDACTION_PLACEHOLDER);
  }
  for (const { pattern, valueGroup } of GLOBAL_CREDENTIAL_TEXT_PATTERNS) {
    redactedText = redactedText.replace(
      pattern,
      (match: string, ...groups: unknown[]) => {
        const value = groups[valueGroup - 1];
        return typeof value === "string" && hasSecretEvidence(value)
          ? REDACTION_PLACEHOLDER
          : match;
      },
    );
  }
  return { text: redactedText, redacted: redactedText !== text };
}

/**
 * Whether a schema position is credential-bearing on its own: declared
 * `writeOnly`, a credential-declaring `format` such as `password`, or a
 * credential segment name. Every value in such a position is suspect, so
 * examples, enum members, and constants are never persisted from it.
 */
export function isCredentialLikeSchemaPosition(
  schema: JsonRecord,
  propertyName: string | undefined,
): boolean {
  const declaredName =
    typeof schema.name === "string" ? schema.name : undefined;
  const declaredFormat =
    typeof schema.format === "string" ? schema.format : undefined;
  return (
    schema.writeOnly === true ||
    isCredentialPositionName(propertyName ?? declaredName ?? "") ||
    (declaredFormat !== undefined && isCredentialPositionName(declaredFormat))
  );
}

function stripExampleMaterial(target: JsonRecord): void {
  delete target.example;
  delete target.examples;
  delete target.default;
}

function stripCredentialLikeValues(target: JsonRecord): void {
  if (isCredentialLikeValue(target.example)) {
    delete target.example;
  }
  if (Array.isArray(target.examples)) {
    const kept = target.examples.filter(
      (value) => !isCredentialLikeValue(value),
    );
    if (kept.length === 0) {
      delete target.examples;
    } else {
      target.examples = kept;
    }
  }
  if (isCredentialLikeValue(target.default)) {
    delete target.default;
  }
}

function stripSchema(
  schema: JsonRecord,
  propertyName: string | undefined,
  forceStrip: boolean,
): JsonRecord {
  const credentialLike =
    forceStrip ||
    isCredentialLikeSchemaPosition(
      schema,
      propertyName ??
        (typeof schema.name === "string" ? schema.name : undefined),
    );

  const result: JsonRecord = { ...schema };
  if (credentialLike) {
    stripExampleMaterial(result);
  } else {
    stripCredentialLikeValues(result);
  }

  const pathName =
    propertyName ?? (typeof schema.name === "string" ? schema.name : undefined);

  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    const children = result[keyword];
    if (!isRecord(children)) continue;
    result[keyword] = Object.fromEntries(
      Object.entries(children).map(([key, child]) => [
        key,
        isRecord(child) ? stripSchema(child, key, credentialLike) : child,
      ]),
    );
  }

  const items = result.items;
  if (isRecord(items)) {
    result.items = stripSchema(items, pathName, credentialLike);
  } else if (Array.isArray(items)) {
    result.items = items.map((child) =>
      isRecord(child) ? stripSchema(child, pathName, credentialLike) : child,
    );
  }

  for (const keyword of SCHEMA_LIST_KEYWORDS) {
    const children = result[keyword];
    if (!Array.isArray(children)) continue;
    result[keyword] = children.map((child) =>
      isRecord(child) ? stripSchema(child, pathName, credentialLike) : child,
    );
  }

  const additionalProperties = result.additionalProperties;
  if (isRecord(additionalProperties)) {
    result.additionalProperties = stripSchema(
      additionalProperties,
      pathName,
      credentialLike,
    );
  }

  return result;
}

/**
 * Returns a copy of the schema with `example`/`examples`/`default` removed at
 * every depth whenever the position is credential-bearing (`writeOnly`, a
 * credential format, a credential segment name, or a credential-bearing
 * ancestor). Other schemas only lose individual values that themselves look
 * like token assignments, JWTs, bearer values, or vendor keys.
 */
export function stripSensitiveExamples(schema: JsonRecord): JsonRecord {
  return stripSchema(schema, undefined, false);
}
