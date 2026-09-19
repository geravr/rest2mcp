import { describe, expect, it } from "vitest";
import {
  REDACTION_PLACEHOLDER,
  isCredentialLikeSchemaPosition,
  isCredentialLikeValue,
  isCredentialPositionName,
  redactCredentialText,
  stripSensitiveExamples,
} from "./openapi-redact.js";

const CREDENTIAL = "sk_live_51H8xSECRETVALUE0001";
const JWT = "eyJhbGciOiJIUzI1NiJ9.c2VjcmV0.LongBase64SignatureValue";
const BEARER = "Bearer abcdefghijklmnopqrstuvwxyz0123456789";

/** Google API keys are `AIza` plus exactly 35 key characters. */
const GOOGLE_KEY = `AIzaSy${"A".repeat(33)}`;

/**
 * Every name that must make its position credential-bearing. A regression is
 * reported by name, not by index.
 */
const CREDENTIAL_NAMES = [
  "api_key",
  "apiKey",
  "api-key",
  "x_api_key",
  "X-Api-Key",
  "access_token",
  "accessToken",
  "refresh_token",
  "auth_token",
  "authorization",
  "client_secret",
  "secret_key",
  "secret",
  "private_key",
  "password",
  "passwd",
  "passphrase",
  "credential",
  "credentials",
  "cookie",
  "set_cookie",
  "session_id",
  "sessionid",
  "session_token",
  "sessionToken",
  "bearer",
  "bearer_token",
  "signature",
  "otp",
  "otp_code",
  "token",
  "token_value",
  "secret_value",
  "password_confirmation",
  "password_hash",
  "password_value",
  "api_key_hash",
  "session_token_hash",
  "cookie_value",
  "oauth_token",
  "id_token",
  "auth_key",
  "jwt",
  "totp",
  "pwd",
  "pass",
  "auth",
];

/**
 * Every name that merely qualifies or resembles credential material and must
 * stay ordinary. A regression is reported by name, not by index.
 */
const ORDINARY_NAMES = [
  "key",
  "key_id",
  "key_type",
  "sort_key",
  "monkey",
  "hockey",
  "keyboard",
  "cookie_consent",
  "session",
  "session_type",
  "signature_version",
  "signature_algorithm",
  "token_count",
  "access_token_ttl",
  "client_id",
  "private_key_id",
  "secretary",
  "password_policy",
  "bearer_count",
  "otp_required",
  "author",
  "keyword",
  "keywords",
  "cursor",
  "limit",
  "name",
  "region",
  "tags",
  "date-time",
  "uuid",
  "email",
  "mode",
  "kind",
  "label",
  "value",
  "note",
  "checksum",
  "status",
];

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

describe("openapi-redact helpers", () => {
  it("detects credential-like values by shape", () => {
    for (const value of [
      CREDENTIAL,
      JWT,
      BEARER,
      "APIKEY-abcdef0123456789",
      "dGhpcyBpcyBhIHZlcnkgbG9uZyBzZWNyZXQgYmxvYiB2YWx1ZQ==",
    ]) {
      expect(isCredentialLikeValue(value), value).toBe(true);
    }
    for (const value of ["page-2", "Ada", 42, true, null, "list"]) {
      expect(isCredentialLikeValue(value), String(value)).toBe(false);
    }
  });

  it("detects credential-bearing schema positions", () => {
    expect(isCredentialLikeSchemaPosition({ writeOnly: true }, "value")).toBe(
      true,
    );
    expect(isCredentialLikeSchemaPosition({ type: "string" }, "api_key")).toBe(
      true,
    );
    expect(
      isCredentialLikeSchemaPosition({ type: "string" }, "session_token"),
    ).toBe(true);
    expect(
      isCredentialLikeSchemaPosition(
        { type: "string", format: "password" },
        "",
      ),
    ).toBe(true);
    expect(isCredentialLikeSchemaPosition({ type: "string" }, "author")).toBe(
      false,
    );
    expect(isCredentialLikeSchemaPosition({ type: "string" }, "keyword")).toBe(
      false,
    );
    expect(isCredentialLikeSchemaPosition({ type: "string" }, "cursor")).toBe(
      false,
    );
    expect(isCredentialLikeSchemaPosition({ type: "string" }, undefined)).toBe(
      false,
    );
  });
});

describe("isCredentialPositionName", () => {
  it("matches a credential term anywhere in the name", () => {
    for (const name of CREDENTIAL_NAMES) {
      expect(isCredentialPositionName(name), name).toBe(true);
    }
  });

  it("never matches a name a later segment qualifies", () => {
    for (const name of ORDINARY_NAMES) {
      expect(isCredentialPositionName(name), name).toBe(false);
    }
  });
});

describe("credential value shapes", () => {
  const CASES: Array<{ shape: string; secret: string; control: string }> = [
    {
      shape: "Slack token",
      secret: "xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx",
      control: "xoxo-hugs-and-kisses",
    },
    {
      shape: "AWS access key id",
      secret: "AKIAIOSFODNN7EXAMPLE",
      control: "akiaiosfodnn7example",
    },
    {
      shape: "Google API key",
      secret: GOOGLE_KEY,
      control: "AIzaSyExampleKey",
    },
    {
      shape: "GitHub token",
      secret: "ghp_16C7e42F292c6912E7710c838347Ae178B4a",
      control: "ghp_setup_note",
    },
    {
      shape: "Stripe restricted key",
      secret: "rk_live_51H8xSECRETVALUE0001",
      control: "rk-live-51H8xSECRETVALUE0001",
    },
    {
      shape: "OpenAI project key",
      secret:
        "sk-proj-4f8a2c1e9b7d6a3f0e5c8b2d9a1f7e6c4b3a2d1f0e9c8b7a6d5e4f3a2b1c0d9e",
      control: "sk-project-name",
    },
    {
      shape: "GitLab personal access token",
      secret: "glpat-5nK8xQ2mR7vT1wY4zA6bC9dE",
      control: "glpat-config",
    },
    {
      shape: "Sentry auth token",
      secret:
        "SG.ngeVfQFYQlKU0ufo8x5d1A.TwL2iGABf9DHoTf-09kqeF8tAmbihYzrnopKc-1s5cr-ug",
      control: "SG.docs.reference",
    },
    {
      shape: "npm token",
      secret: "npm_4Fk2mQ9pR7sT1vW3xY5zA8bC0dE6fG2hI4jK",
      control: "npm_install",
    },
    {
      shape: "Slack app token",
      secret:
        "xapp-1-A012B3CDEF4-5678901234567-8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d",
      control: "xapp-config",
    },
    {
      shape: "HuggingFace token",
      secret: "hf_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
      control: "hf_endpoint",
    },
    {
      shape: "PEM private key header",
      secret: "-----BEGIN RSA PRIVATE KEY-----",
      control: "-----BEGIN CERTIFICATE-----",
    },
    {
      shape: "JWT",
      secret: JWT,
      control: "eyJhbGciOiJIUzI1NiJ9",
    },
    {
      shape: "Bearer token",
      secret: BEARER,
      control: "Bearer token",
    },
    {
      shape: "Glued key assignment",
      secret: "APIKEY-abcdef0123456789",
      control: "key-abcdef0123456789",
    },
  ];

  it("catches each credential shape without catching its control", () => {
    for (const { shape, secret, control } of CASES) {
      expect(isCredentialLikeValue(secret), `${shape} secret`).toBe(true);
      expect(
        isCredentialLikeValue(control),
        `${shape} control: ${control}`,
      ).toBe(false);
      const redacted = redactCredentialText(secret);
      expect(redacted.redacted, `${shape} secret`).toBe(true);
      expect(redacted.text, `${shape} secret`).not.toContain(secret);
      expect(redactCredentialText(control).text, `${shape} control`).toBe(
        control,
      );
    }
  });
});

describe("credential assignments", () => {
  const CASES: Array<{ shape: string; secret: string; control: string }> = [
    {
      shape: "equals assignment",
      secret: "api_key=8f3a1c9e2b7d4f60a1b2c3d4e5f60718",
      control: "api_key: string",
    },
    {
      shape: "colon assignment",
      secret: "api_key: 8f3a1c9e2b7d4f60a1b2c3d4e5f60718",
      control: "token: number",
    },
    {
      shape: "token assignment",
      secret: "token=8f3a1c9e2b7d4f60a1b2c3d4e5f60718",
      control: "password: string",
    },
    {
      shape: "password assignment",
      secret: "password=correct-horse-battery",
      control: "secret: required",
    },
    {
      shape: "secret assignment",
      secret: "secret: correct-horse-battery",
      control: "authorization: configured",
    },
    {
      shape: "authorization basic",
      secret: "Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==",
      control: "Authorization: Basic",
    },
    {
      shape: "quoted JSON",
      secret: '{"api_key": "abcdef1234567890"}',
      control: '{"api_key": "required"}',
    },
    {
      shape: "XML tag",
      secret: "<api_key>abcdef1234567890</api_key>",
      control: "<api_key>string</api_key>",
    },
    {
      shape: "session id assignment",
      secret: "session_id=8f3a1c9e2b7d4f60a1b2c3d4e5f60718",
      control: "session_id: number",
    },
    {
      shape: "otp code assignment",
      secret: "otp_code=123456789012345",
      control: "otp: number",
    },
    {
      shape: "x-api-key assignment",
      secret: "x-api-key: 8f3a1c9e2b7d4f60a1b2c3d4e5f60718",
      control: "x-api-key: string",
    },
    {
      shape: "long JWT segment",
      secret: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImFiYw",
      control: "authentication",
    },
    {
      shape: "long mixed-case base64",
      secret: "dGhpcyBpcyBhIHZlcnkgbG9uZyBzZWNyZXQgYmxvYiB2YWx1ZQ==",
      control: "this is a long secret blob value",
    },
  ];

  it("catches assignment shapes while rejecting type annotations and prose", () => {
    for (const { shape, secret, control } of CASES) {
      expect(isCredentialLikeValue(secret), `${shape} secret`).toBe(true);
      expect(
        isCredentialLikeValue(control),
        `${shape} control: ${control}`,
      ).toBe(false);
      expect(redactCredentialText(secret).redacted, `${shape} secret`).toBe(
        true,
      );
      expect(redactCredentialText(control).text, `${shape} control`).toBe(
        control,
      );
    }
  });

  it("replaces only the credential span", () => {
    const secret = "8f3a1c9e2b7d4f60a1b2c3d4e5f60718";
    const text = `Send Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ== then read the page`;

    expect(redactCredentialText(text).text).toBe(
      `Send ${REDACTION_PLACEHOLDER} then read the page`,
    );
    expect(redactCredentialText(`<api_key>${secret}</api_key>`).text).toBe(
      REDACTION_PLACEHOLDER,
    );
    expect(redactCredentialText(`{"api_key": "${secret}"}`).text).toBe(
      `{${REDACTION_PLACEHOLDER}}`,
    );
  });

  it("rejects long single-case filler that has no secret evidence", () => {
    for (const text of [
      "token: paginationcursor",
      "pass: somelongvaluewithoutdigits",
      "secret: configuredperrequest",
      "password: correnthorsebattery",
    ]) {
      expect(isCredentialLikeValue(text), text).toBe(false);
      expect(redactCredentialText(text).text, text).toBe(text);
    }
  });
});

describe("credential-like value survivors", () => {
  const SHA256_LOWER =
    "8f3a1c9e2b7d4f60a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f7081";
  const SHA256_UPPER =
    "8F3A1C9E2B7D4F60A1B2C3D4E5F60718293A4B5C6D7E8F901A2B3C4D5E6F7081";

  const SURVIVORS: Array<{ shape: string; value: string }> = [
    { shape: "lowercase SHA-256 hex digest", value: SHA256_LOWER },
    { shape: "uppercase SHA-256 hex digest", value: SHA256_UPPER },
    {
      shape: "32-character ULID",
      value: "01ARZ3NDEKTSV4RRFFQ69G5FAV01ARZ3N",
    },
    {
      shape: "opaque cursor",
      value: "cursor_01ARZ3NDEKTSV4RRFFQ69G5FAV01ARZ",
    },
    { shape: "UUID", value: "123e4567-e89b-12d3-a456-426614174000" },
    { shape: "MD5 hex digest", value: "d41d8cd98f00b204e9800998ecf8427e" },
    { shape: "sha256 ETag", value: `W/"${SHA256_LOWER}"` },
    { shape: "PEM certificate header", value: "-----BEGIN CERTIFICATE-----" },
    { shape: "page cursor", value: "page-2" },
    { shape: "ordinary text", value: "machine learning" },
  ];

  it("never treats identifiers or certificate headers as credentials", () => {
    for (const { shape, value } of SURVIVORS) {
      expect(isCredentialLikeValue(value), `${shape}: ${value}`).toBe(false);
      expect(redactCredentialText(value).text, `${shape}: ${value}`).toBe(
        value,
      );
    }
  });
});

describe("redactCredentialText", () => {
  it("replaces credential-shaped spans while keeping the prose readable", () => {
    const text = `List items using key ${CREDENTIAL} and Authorization: ${BEARER}`;

    const result = redactCredentialText(text);

    expect(result.redacted).toBe(true);
    expect(result.text).toContain("List items using key");
    expect(result.text).toContain(REDACTION_PLACEHOLDER);
    expect(result.text).not.toContain("sk_live");
    expect(result.text).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("leaves prose that merely names credentials untouched", () => {
    for (const text of [
      "Authentication uses the API key header; the secret is never echoed back.",
      "Bearer authentication is required for this endpoint.",
      "Send the API key header.",
      "The secret is never echoed back.",
      "Bearer token forwarding to the upstream service is supported.",
      "Configure the password policy before rotating keys.",
    ]) {
      expect(redactCredentialText(text), text).toEqual({
        text,
        redacted: false,
      });
    }
  });

  it("replaces only the credential span inside an otherwise intact summary", () => {
    const mixedBase64 = "dGhpcyBpcyBhIHZlcnkgbG9uZyBzZWNyZXQgYmxvYiB2YWx1ZQ==";
    const text = `Read the signed payload ${JWT}, never ${CREDENTIAL}, and ignore ${mixedBase64} when caching`;

    expect(redactCredentialText(text).text).toBe(
      `Read the signed payload ${REDACTION_PLACEHOLDER}, never ${REDACTION_PLACEHOLDER}, and ignore ${REDACTION_PLACEHOLDER} when caching`,
    );
  });

  it("leaves ordinary summaries, tags, and formats untouched", () => {
    for (const text of [
      "List customers",
      "catalog",
      "session",
      "author",
      "token count per page",
      "Set the page size.",
    ]) {
      expect(redactCredentialText(text), text).toEqual({
        text,
        redacted: false,
      });
    }
  });
});

describe("stripSensitiveExamples recursion", () => {
  it("removes a credential-like example from every recursion branch", () => {
    const schema = {
      allOf: [
        {
          type: "object",
          properties: { api_key: { type: "string", example: CREDENTIAL } },
        },
      ],
      anyOf: [{ type: "string", example: CREDENTIAL }],
      oneOf: [{ type: "string", default: CREDENTIAL }],
      prefixItems: [{ type: "string", example: CREDENTIAL }],
      items: [{ type: "string", example: CREDENTIAL }],
      additionalProperties: { type: "string", example: CREDENTIAL },
    };

    const stripped = stripSensitiveExamples(schema);

    expect(serialized(stripped)).not.toContain(CREDENTIAL);
    expect(serialized(stripped)).not.toContain("sk_live");
    expect(stripped).not.toBe(schema);
  });

  it("strips credential-like examples nested inside arrays of schemas", () => {
    const schema = {
      type: "array",
      items: [
        {
          type: "object",
          properties: { token: { type: "string", example: JWT } },
        },
        { type: "string", example: JWT },
      ],
    };

    const stripped = stripSensitiveExamples(schema);

    expect(serialized(stripped)).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    const items = stripped.items as Array<Record<string, unknown>>;
    expect(items[1]).toEqual({ type: "string" });
  });

  it("strips at depth through properties and patternProperties", () => {
    const schema = {
      type: "object",
      properties: {
        wrapper: {
          type: "object",
          properties: {
            inner: {
              type: "object",
              patternProperties: {
                ".*": { type: "string", default: BEARER },
              },
              properties: { leaf: { type: "string", example: BEARER } },
            },
          },
        },
      },
    };

    const stripped = stripSensitiveExamples(schema);

    expect(serialized(stripped)).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("keeps non-credential examples untouched at every depth", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string", example: "Ada" } },
      allOf: [{ type: "string", default: "kept" }],
    };

    const stripped = stripSensitiveExamples(schema);

    expect(serialized(stripped)).toContain("Ada");
    expect(serialized(stripped)).toContain("kept");
  });

  it("keeps example material on ordinary positions such as author and keyword", () => {
    const schema = {
      type: "object",
      properties: {
        author: { type: "string", example: "Ada Lovelace" },
        keyword: { type: "string", default: "machine learning" },
        session: { type: "string", enum: ["morning", "evening"] },
      },
    };

    const stripped = stripSensitiveExamples(schema);

    expect(serialized(stripped)).toContain("Ada Lovelace");
    expect(serialized(stripped)).toContain("machine learning");
    expect(serialized(stripped)).toContain("morning");
  });

  it("keeps a checksum enum of SHA-256 digests and its example whole", () => {
    const digests = [
      "8f3a1c9e2b7d4f60a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f7081",
      "5c2b8f1a9d3e7b40618293a4b5c6d7e8f901a2b3c4d5e6f70819f3a1c9e2b7d4",
    ];
    const schema = {
      type: "object",
      properties: {
        checksum: {
          type: "string",
          enum: digests,
          example: digests[0],
          default: digests[1],
        },
      },
    };

    const stripped = stripSensitiveExamples(schema);

    const property = (
      stripped.properties as Record<string, Record<string, unknown>>
    ).checksum!;
    expect(property.enum).toEqual(digests);
    expect(property.example).toBe(digests[0]);
    expect(property.default).toBe(digests[1]);
  });

  it("treats a password format as credential-bearing", () => {
    const schema = {
      type: "object",
      properties: {
        pin: { type: "string", format: "password", example: "1234" },
      },
    };

    expect(serialized(stripSensitiveExamples(schema))).not.toContain("1234");
  });
});
