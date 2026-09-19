import { describe, expect, it } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import {
  assertCompileSuccess,
  compileToolDefinition,
  type CompileContext,
} from "./mcp-compiler.js";
import {
  buildAgentInputZodObject,
  compileAgentToolContract,
  contractFingerprint,
  MCP_CONTRACT_META_KEY,
  MCP_SENSITIVE_META_KEY,
  toSerializableContract,
} from "./mcp-contract.js";
import type {
  McpAgentInput,
  McpRequestDefinition,
} from "./mcp-request-definition.js";

function makeDefinition(
  inputs: McpAgentInput[],
  overrides: Partial<McpRequestDefinition> = {},
): McpRequestDefinition {
  return {
    version: 1,
    pathSegments: [{ id: "seg0", value: { kind: "literal", value: "/items" } }],
    query: inputs.map((input, index) => ({
      id: `query_${index}`,
      name: input.name,
      value: { kind: "agentInput", agentInputId: input.id },
      omitWhenAbsent: !input.required,
    })),
    headers: [],
    body: { bodyType: "none" },
    agentInputs: inputs,
    ...overrides,
  };
}

function makePlan(
  inputs: McpAgentInput[],
  overrides: Partial<CompileContext> = {},
) {
  const result = compileToolDefinition({
    method: "GET",
    definition: makeDefinition(inputs),
    common: { headers: [], query: [] },
    auth: null,
    serverValues: [],
    basePath: "/v1",
    allowMutation: false,
    ...overrides,
  });
  return assertCompileSuccess(result);
}

function input(overrides: Partial<McpAgentInput>): McpAgentInput {
  return {
    id: "ain_1",
    name: "q",
    description: "Search query.",
    required: false,
    sensitive: false,
    type: "string",
    ...overrides,
  };
}

function compile(
  inputs: McpAgentInput[],
  copy: Partial<{ title: string | null; description: string | null }> = {},
  planOverrides: Partial<CompileContext> = {},
) {
  return compileAgentToolContract({
    name: "search",
    title: copy.title ?? "Search items",
    description: copy.description ?? "Search upstream items by query.",
    method: planOverrides.method ?? "GET",
    plan: makePlan(inputs, planOverrides),
  });
}

describe("compileAgentToolContract", () => {
  it("produces a closed, fingerprinted contract with namespaced metadata", () => {
    const result = compile([input({})]);
    expect(result.ok).toBe(true);
    const contract = result.contract!;
    expect(contract.contractVersion).toBe(1);
    expect(contract.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(contract.metadata[MCP_CONTRACT_META_KEY].fingerprint).toBe(
      contract.fingerprint,
    );
    expect(contract.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(contract.outputSchema).toMatchObject({ type: "object" });
    expect(contract.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it("keeps the fingerprint stable for identical persisted intent across recompiles", () => {
    const first = compile([input({})]).contract!.fingerprint;
    const second = compile([input({})]).contract!.fingerprint;
    expect(second).toBe(first);
    expect(contractFingerprint({ z: 1, a: [{ y: 2, x: 1 }] })).toBe(
      contractFingerprint({ a: [{ x: 1, y: 2 }], z: 1 }),
    );
  });

  it("changes the fingerprint when an agent-visible description changes", () => {
    const before = compile([input({})]).contract!.fingerprint;
    const after = compile([input({})], {
      description: "Different outcome-oriented description.",
    }).contract!.fingerprint;
    expect(after).not.toBe(before);
  });

  it("excludes secret-derived material and stays stable across rotation", () => {
    const inputs = [input({})];
    const definitionWithSecret = makeDefinition(inputs, {
      headers: [
        {
          id: "hdr_1",
          name: "Authorization",
          value: { kind: "serverValue", serverValueId: "msv_secret" },
        },
      ],
    });
    const compileWithSecretName = (name: string) =>
      compileAgentToolContract({
        name: "search",
        title: "Search items",
        description: "Search upstream items by query.",
        method: "GET",
        plan: assertCompileSuccess(
          compileToolDefinition({
            method: "GET",
            definition: definitionWithSecret,
            common: { headers: [], query: [] },
            auth: null,
            serverValues: [
              {
                id: "msv_secret",
                name,
                kind: "secret",
                owner: "manual",
              },
            ],
            basePath: "/v1",
            allowMutation: false,
          }),
        ),
      });

    const before = compileWithSecretName("api_token");
    const after = compileWithSecretName("rotated_token");
    const serialized = JSON.stringify(before.contract);
    expect(serialized).not.toContain("msv_secret");
    expect(serialized).not.toContain("api_token");
    expect(after.contract!.fingerprint).toBe(before.contract!.fingerprint);
  });

  it("preserves supported string formats in schema and runtime validation", () => {
    const result = compile([
      input({ format: "date-time", type: "string", name: "when" }),
    ]);
    const contract = result.contract!;
    const properties = (
      contract.inputSchema as {
        properties: Record<string, { format?: string }>;
      }
    ).properties;
    expect(properties.when.format).toBe("date-time");
    expect(
      contract.inputValidator.safeParse({ when: "2024-01-01T00:00:00Z" })
        .success,
    ).toBe(true);
    expect(contract.inputValidator.safeParse({ when: "nope" }).success).toBe(
      false,
    );
  });

  it("marks sensitive inputs write-only without examples or values", () => {
    const result = compile([
      input({
        name: "token",
        sensitive: true,
        examples: ["super-secret"],
      }),
    ]);
    const contract = result.contract!;
    const properties = (
      contract.inputSchema as {
        properties: Record<string, Record<string, unknown>>;
      }
    ).properties;
    expect(properties.token.writeOnly).toBe(true);
    expect(properties.token[MCP_SENSITIVE_META_KEY]).toBe(true);
    expect(properties.token.examples).toBeUndefined();
    expect(JSON.stringify(contract)).not.toContain("super-secret");
  });

  it("rejects an invalid pattern instead of silently dropping it", () => {
    const result = compile([input({ pattern: "([" })]);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((i) => i.code === APP_ERROR_CODES.MCP_COMPILE_INVALID),
    ).toBe(true);
  });

  it("rejects unsupported formats, contradictory bounds, and incompatible enums", () => {
    const format = compile([input({ format: "ipv4" as never, name: "addr" })]);
    expect(format.ok).toBe(false);

    const bounds = compile([
      input({ minimum: 10, maximum: 1, type: "number" }),
    ]);
    expect(bounds.ok).toBe(false);

    const enumIssue = compile([input({ enum: [1, 2], type: "string" })]);
    expect(enumIssue.ok).toBe(false);
  });

  it("rejects missing input descriptions and semantic copy", () => {
    const missingInput = compile([input({ description: undefined })]);
    expect(missingInput.ok).toBe(false);

    const missingTitle = compile([input({})], { title: "   " });
    expect(missingTitle.ok).toBe(false);

    const missingDescription = compile([input({})], { description: "" });
    expect(missingDescription.ok).toBe(false);
  });

  it("rejects duplicate public input names", () => {
    const issues: Parameters<typeof buildAgentInputZodObject>[1] = [];
    buildAgentInputZodObject(
      [input({ id: "ain_1", name: "q" }), input({ id: "ain_2", name: "q" })],
      issues,
    );
    expect(
      issues.some((i) => i.code === APP_ERROR_CODES.MCP_VARIABLE_NAME_CONFLICT),
    ).toBe(true);
  });

  it("enforces annotation invariants per method", () => {
    const readContradiction = compileAgentToolContract({
      name: "search",
      title: "Search items",
      description: "Search upstream items by query.",
      method: "GET",
      plan: makePlan([input({})], {
        definition: makeDefinition([input({})], {
          annotations: { readOnlyHint: false },
        }),
      }),
    });
    expect(readContradiction.ok).toBe(false);

    const mutatingReadOnly = compileAgentToolContract({
      name: "create_item",
      title: "Create item",
      description: "Create an upstream item.",
      method: "POST",
      plan: makePlan([input({ required: true })], {
        method: "POST",
        allowMutation: true,
        definition: makeDefinition([input({ required: true })], {
          annotations: { readOnlyHint: true },
        }),
      }),
    });
    expect(mutatingReadOnly.ok).toBe(false);
  });

  it("exposes a serializable contract without the runtime validator", () => {
    const contract = compile([input({})]).contract!;
    const serializable = toSerializableContract(contract);
    expect("inputValidator" in serializable).toBe(false);
    expect(serializable.fingerprint).toBe(contract.fingerprint);
    expect(JSON.stringify(serializable)).not.toContain("inputValidator");
  });

  it("accepts only an empty object for a zero-input tool", () => {
    const result = compile([]);
    expect(result.ok).toBe(true);
    const contract = result.contract!;
    expect(contract.inputValidator.safeParse({}).success).toBe(true);
    expect(contract.inputValidator.safeParse({ extra: 1 }).success).toBe(false);
  });
});
