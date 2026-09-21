import {
  MCP_MAX_TOOLS_PER_SERVER_BOUNDS,
  MCP_MAX_TOOLS_PER_SERVER_DEFAULT,
} from "@repo/core";
import { describe, expect, it } from "vitest";
import { envSchema } from "./env-schema.js";

const validEnv = {
  ENVIRONMENT: "development",
  APP_ORIGIN: "http://localhost:5173",
  DATABASE_URL: "postgres://postgres:postgres@localhost:5452/example",
  BETTER_AUTH_SECRET: "x".repeat(32),
  MCP_CREDENTIAL_SECRET: "y".repeat(32),
  AI_CREDENTIAL_SECRET: "z".repeat(32),
  RESEND_API_KEY: "re_test",
  RESEND_EMAIL_FROM: "onboarding@example.com",
} satisfies Record<string, string>;

describe("MCP_MAX_TOOLS_PER_SERVER", () => {
  it("falls back to the shared default when unset", () => {
    expect(envSchema.parse(validEnv).MCP_MAX_TOOLS_PER_SERVER).toBe(
      MCP_MAX_TOOLS_PER_SERVER_DEFAULT,
    );
  });

  it("falls back to the shared default when assigned an empty value", () => {
    expect(
      envSchema.parse({ ...validEnv, MCP_MAX_TOOLS_PER_SERVER: "" })
        .MCP_MAX_TOOLS_PER_SERVER,
    ).toBe(MCP_MAX_TOOLS_PER_SERVER_DEFAULT);
  });

  it("falls back to the shared default when assigned whitespace", () => {
    expect(
      envSchema.parse({ ...validEnv, MCP_MAX_TOOLS_PER_SERVER: "  " })
        .MCP_MAX_TOOLS_PER_SERVER,
    ).toBe(MCP_MAX_TOOLS_PER_SERVER_DEFAULT);
  });

  it("accepts a configured cap inside the shared bounds", () => {
    expect(
      envSchema.parse({ ...validEnv, MCP_MAX_TOOLS_PER_SERVER: "12" })
        .MCP_MAX_TOOLS_PER_SERVER,
    ).toBe(12);
    expect(
      envSchema.parse({
        ...validEnv,
        MCP_MAX_TOOLS_PER_SERVER: String(MCP_MAX_TOOLS_PER_SERVER_BOUNDS.min),
      }).MCP_MAX_TOOLS_PER_SERVER,
    ).toBe(MCP_MAX_TOOLS_PER_SERVER_BOUNDS.min);
    expect(
      envSchema.parse({
        ...validEnv,
        MCP_MAX_TOOLS_PER_SERVER: String(MCP_MAX_TOOLS_PER_SERVER_BOUNDS.max),
      }).MCP_MAX_TOOLS_PER_SERVER,
    ).toBe(MCP_MAX_TOOLS_PER_SERVER_BOUNDS.max);
  });

  it.each([
    "0",
    String(MCP_MAX_TOOLS_PER_SERVER_BOUNDS.max + 1),
    "2.5",
    "many",
  ])("rejects the out-of-range cap %s", (value) => {
    expect(
      envSchema.safeParse({ ...validEnv, MCP_MAX_TOOLS_PER_SERVER: value })
        .success,
    ).toBe(false);
  });
});
