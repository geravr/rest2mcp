/**
 * Policy tests for `AI_TOOL_OPTIMIZATION_POLICY_V1`: every allowed operation
 * passes validation, every forbidden path/method/auth/header/secret/literal/
 * node/type/enablement/publication attempt is rejected, and one invalid
 * operation never contaminates valid recommendations.
 */
import { describe, expect, it } from "vitest";
import {
  OPTIMIZER_ADVISORY_CODES,
  OPTIMIZER_REJECTED_CODES,
  type OptimizerToolSnapshotV1,
} from "./mcp-optimizer-contracts.js";
import { MCP_REQUEST_DEFINITION_VERSION } from "./mcp-policy.js";
import {
  mcpRequestDefinitionSchema,
  type McpRequestDefinition,
} from "./mcp-request-definition.js";
import {
  applyOptimizerOperation,
  buildItemReview,
  parseModelItemOutput,
  type OptimizerPolicyCompileContext,
} from "./mcp-optimizer-policy.js";

const DEFINITION: McpRequestDefinition = mcpRequestDefinitionSchema.parse({
  version: MCP_REQUEST_DEFINITION_VERSION,
  pathSegments: [
    { id: "p1", value: { kind: "literal", value: "users" } },
    { id: "p2", value: { kind: "agentInput", agentInputId: "ain_id" } },
  ],
  query: [
    {
      id: "q1",
      name: "limit",
      value: { kind: "agentInput", agentInputId: "ain_limit" },
      serialization: { style: "form", explode: false },
    },
    {
      id: "q2",
      name: "api_key",
      value: { kind: "serverValue", serverValueId: "mcv_key" },
    },
    {
      id: "q3",
      name: "token",
      value: { kind: "agentInput", agentInputId: "ain_secret" },
    },
  ],
  headers: [],
  body: {
    bodyType: "json",
    root: {
      kind: "object",
      fields: [
        {
          id: "f1",
          key: "email",
          value: {
            kind: "binding",
            binding: { kind: "agentInput", agentInputId: "ain_email" },
            jsonType: "string",
          },
        },
        {
          id: "f2",
          key: "note",
          value: {
            kind: "literal",
            jsonType: "string",
            value: "static-note",
          },
        },
      ],
    },
  },
  agentInputs: [
    {
      id: "ain_id",
      name: "id",
      required: true,
      sensitive: false,
      type: "string",
    },
    {
      id: "ain_limit",
      name: "limit",
      required: false,
      sensitive: false,
      type: "array",
      items: { type: "integer" },
    },
    {
      id: "ain_email",
      name: "email",
      required: false,
      sensitive: false,
      type: "string",
    },
    {
      id: "ain_secret",
      name: "token",
      required: false,
      sensitive: true,
      type: "string",
    },
  ],
});

const SNAPSHOT: OptimizerToolSnapshotV1 = {
  snapshotVersion: 1,
  source: "draft",
  toolId: "mct_1",
  name: "get_users",
  title: "Get users",
  description: "Fetch users.",
  method: "POST",
  pathShape: [
    { kind: "literal", text: "users" },
    { kind: "parameter", agentInputId: "ain_id" },
  ],
  inputs: [
    {
      sensitivity: "normal",
      id: "ain_id",
      name: "id",
      type: "string",
      required: true,
    },
    {
      sensitivity: "normal",
      id: "ain_limit",
      name: "limit",
      type: "array",
      required: false,
    },
    {
      sensitivity: "normal",
      id: "ain_email",
      name: "email",
      type: "string",
      required: false,
    },
    {
      sensitivity: "sensitive",
      ref: "s1",
      type: "string",
      required: false,
    },
  ],
  query: [
    {
      id: "q1",
      name: "limit",
      binding: "agentInput",
      agentInputId: "ain_limit",
      serialization: { style: "form", explode: false },
    },
    { id: "q2", name: "api_key", binding: "serverValue" },
    { id: "q3", name: "token", binding: "sensitiveInput" },
  ],
  headerPresence: { names: [] },
  body: {
    bodyType: "json",
    root: {
      kind: "object",
      fields: [
        {
          id: "f1",
          key: "email",
          value: {
            kind: "binding",
            binding: "agentInput",
            agentInputId: "ain_email",
            jsonType: "string",
          },
        },
        {
          id: "f2",
          key: "note",
          value: { kind: "literal", jsonType: "string" },
        },
      ],
    },
  },
  issues: [],
};

const COMPILE: OptimizerPolicyCompileContext = {
  common: { headers: [], query: [] },
  auth: null,
  serverValues: [
    { id: "mcv_key", name: "api_key", kind: "config", owner: "manual" },
  ],
  basePath: "/",
  allowMutation: false,
};

function review(
  operations: unknown[],
  existingNames: string[] = ["other_tool"],
) {
  return buildItemReview({
    snapshot: SNAPSHOT,
    definition: DEFINITION,
    operations: parseModelItemOutput({ operations }).operations,
    preRejected: parseModelItemOutput({ operations }).rejected,
    advisories: parseModelItemOutput({ advisories: [] }).advisories,
    compile: COMPILE,
    existingToolNames: existingNames,
  });
}

let opSeq = 0;
function op(operation: Record<string, unknown>) {
  opSeq += 1;
  return {
    operationId: `op${opSeq}`,
    rationale: "Improve clarity.",
    ...operation,
  };
}

describe("optimizer policy: allowed operations", () => {
  it("accepts every safe metadata operation", () => {
    const result = review([
      op({ kind: "set_tool_name", value: "get_users_v2" }),
      op({ kind: "set_tool_title", value: "Fetch users" }),
      op({ kind: "set_tool_description", value: "Fetch user records." }),
      op({ kind: "set_input_name", inputId: "ain_limit", value: "page_size" }),
      op({
        kind: "set_input_description",
        inputId: "ain_limit",
        value: "Number of records per page.",
      }),
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.operations.map((o) => o.class)).toEqual([
      "safe",
      "safe",
      "safe",
      "safe",
      "safe",
    ]);
  });

  it("accepts guarded query operations with redacted diffs", () => {
    const result = review([
      op({ kind: "set_query_entry_key", entryId: "q1", value: "page_size" }),
      op({
        kind: "set_query_entry_serialization",
        entryId: "q1",
        explode: true,
      }),
      op({
        kind: "set_query_entry_omit_when_absent",
        entryId: "q1",
        value: true,
      }),
      op({
        kind: "rebind_query_entry",
        entryId: "q2",
        agentInputId: "ain_email",
      }),
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.operations.every((o) => o.class === "guarded")).toBe(true);
    const withDiff = result.operations.filter((o) => o.requestDiff?.length);
    expect(withDiff.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(result.operations);
    // Redaction: no server value ids, no literal values, no raw URLs.
    expect(serialized).not.toContain("mcv_key");
    expect(serialized).not.toContain("static-note");
    expect(serialized).not.toMatch(/https?:\/\//);
  });

  it("accepts guarded JSON field operations", () => {
    const result = review([
      op({ kind: "set_json_field_key", fieldId: "f1", value: "email_address" }),
      op({
        kind: "set_json_field_omit_when_absent",
        fieldId: "f1",
        value: true,
      }),
    ]);
    expect(result.rejected).toEqual([]);
  });

  it("preserves canonical ids and immutable fields while patching", () => {
    const applied = applyOptimizerOperation(
      {
        definition: DEFINITION,
        toolName: SNAPSHOT.name,
        toolTitle: SNAPSHOT.title,
        toolDescription: SNAPSHOT.description,
      },
      {
        kind: "set_query_entry_key",
        operationId: "op1",
        entryId: "q1",
        value: "page_size",
        rationale: "Clearer name.",
      },
    );
    expect(applied).not.toBeNull();
    if (!applied) return;
    expect(applied.definition.query[0]!.id).toBe("q1");
    expect(applied.definition.query[0]!.value).toEqual(
      DEFINITION.query[0]!.value,
    );
    expect(applied.definition.pathSegments).toEqual(DEFINITION.pathSegments);
    expect(applied.definition.agentInputs).toEqual(DEFINITION.agentInputs);
    expect(applied.definition.headers).toEqual(DEFINITION.headers);
    expect(applied.definition.version).toBe(MCP_REQUEST_DEFINITION_VERSION);
    // The second query entry (serverValue) is untouched.
    expect(applied.definition.query[1]).toEqual(DEFINITION.query[1]);
  });
});

describe("optimizer policy: forbidden attempts fail closed", () => {
  it("rejects unknown or forbidden operation kinds without retaining values", () => {
    const parsed = parseModelItemOutput({
      operations: [
        { kind: "set_path", operationId: "x1", value: "/admin/users" },
        { kind: "set_method", operationId: "x2", value: "DELETE" },
        { kind: "set_base_url", operationId: "x3", value: "https://evil.test" },
        { kind: "set_allowed_host", operationId: "x4", value: "evil.test" },
        {
          kind: "set_header",
          operationId: "x5",
          name: "X-Auth",
          value: "token",
        },
        { kind: "set_auth", operationId: "x6", kind2: "bearer" },
        { kind: "set_secret", operationId: "x7", value: "hunter2" },
        { kind: "add_node", operationId: "x8" },
        { kind: "delete_node", operationId: "x9" },
        { kind: "set_input_type", operationId: "x10", value: "json" },
        { kind: "set_input_required", operationId: "x11", value: false },
        { kind: "set_annotations", operationId: "x12" },
        { kind: "set_allow_mutation", operationId: "x13", value: true },
        { kind: "set_enabled", operationId: "x14", value: false },
        { kind: "set_group", operationId: "x15" },
        { kind: "publish", operationId: "x16" },
        {
          kind: "set_tool_name",
          operationId: "x17",
          value: "ok_name",
          rationale: "r",
        },
      ],
    });
    // Only the final well-formed known-kind operation survives parsing.
    expect(parsed.operations.map((o) => o.operationId)).toEqual(["x17"]);
    expect(parsed.rejected).toHaveLength(16);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("https://evil.test");
    expect(serialized).not.toContain("hunter2");
  });

  it("rejects duplicate operation ids", () => {
    const result = review([
      {
        kind: "set_tool_title",
        operationId: "dup1",
        value: "One",
        rationale: "r",
      },
      {
        kind: "set_tool_title",
        operationId: "dup1",
        value: "Two",
        rationale: "r",
      },
    ]);
    expect(
      result.rejected.some(
        (d) => d.code === OPTIMIZER_REJECTED_CODES.DUPLICATE_OPERATION,
      ),
    ).toBe(true);
    expect(result.operations).toHaveLength(1);
  });

  it("rejects unknown and cross-item targets without touching valid operations", () => {
    const result = review([
      op({ kind: "set_query_entry_key", entryId: "q_other_item", value: "x" }),
      op({ kind: "set_query_entry_key", entryId: "q1", value: "page_size" }),
      op({ kind: "set_json_field_key", fieldId: "f_forever", value: "y" }),
      op({ kind: "set_input_description", inputId: "ain_nope", value: "z" }),
    ]);
    expect(result.rejected).toHaveLength(3);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.after).toContain("page_size");
  });

  it("rejects sensitive-input targets", () => {
    const result = review([
      op({ kind: "set_input_name", inputId: "ain_secret", value: "token2" }),
      op({
        kind: "rebind_query_entry",
        entryId: "q1",
        agentInputId: "ain_secret",
      }),
      op({ kind: "rebind_json_field", fieldId: "f1", agentInputId: "s1" }),
    ]);
    expect(result.rejected.map((d) => d.code)).toEqual(
      expect.arrayContaining([
        OPTIMIZER_REJECTED_CODES.UNKNOWN_TARGET,
        OPTIMIZER_REJECTED_CODES.SENSITIVE_TARGET,
      ]),
    );
    expect(result.operations).toHaveLength(0);
  });

  it("rejects omission flags on required, literal, or server-value bindings", () => {
    const result = review([
      op({
        kind: "set_query_entry_omit_when_absent",
        entryId: "q2",
        value: true,
      }),
      {
        kind: "set_json_field_omit_when_absent",
        operationId: "op2",
        fieldId: "f2",
        value: true,
        rationale: "r",
      },
    ]);
    expect(result.rejected.map((d) => d.code)).toEqual([
      OPTIMIZER_REJECTED_CODES.FORBIDDEN_TARGET,
      OPTIMIZER_REJECTED_CODES.FORBIDDEN_TARGET,
    ]);
  });

  it("rejects name conflicts with existing tools", () => {
    const result = review([op({ kind: "set_tool_name", value: "other_tool" })]);
    expect(result.rejected.map((d) => d.code)).toEqual([
      OPTIMIZER_REJECTED_CODES.NAME_CONFLICT,
    ]);
  });

  it("rejects invalid proposed input names", () => {
    const result = review([
      op({ kind: "set_input_name", inputId: "ain_limit", value: "Not A Name" }),
    ]);
    expect(result.rejected.map((d) => d.code)).toEqual([
      OPTIMIZER_REJECTED_CODES.POLICY_REJECTED,
    ]);
  });

  it("bounds operations and rejects overflow", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      op({
        kind: "set_tool_title",
        value: `Title ${i}`,
        operationId: `op${i}`,
      }),
    );
    const result = review(many);
    expect(result.operations).toHaveLength(12);
    expect(
      result.rejected.some(
        (d) => d.code === OPTIMIZER_REJECTED_CODES.OUT_OF_BOUNDS,
      ),
    ).toBe(true);
  });
});

describe("optimizer policy: advisory normalization", () => {
  it("normalizes advisories without machine-applicable values", () => {
    const parsed = parseModelItemOutput({
      operations: [],
      advisories: [
        {
          advisoryId: "a1",
          code: OPTIMIZER_ADVISORY_CODES.SUSPECTED_PATH,
          rationale: "The path may need a version prefix.",
          suggestedValue: "/v2/users",
        },
        {
          advisoryId: "a2",
          code: "brand_new_code",
          rationale: "Unknown concern.",
        },
      ],
    });
    expect(parsed.operations).toEqual([]);
    expect(parsed.advisories).toHaveLength(2);
    expect(parsed.advisories[0]).toEqual({
      advisoryId: "a1",
      code: OPTIMIZER_ADVISORY_CODES.SUSPECTED_PATH,
      rationale: "The path may need a version prefix.",
    });
    // Unknown codes normalize to the bounded restructuring concern.
    expect(parsed.advisories[1]!.code).toBe(
      OPTIMIZER_ADVISORY_CODES.UNSUPPORTED_RESTRUCTURING,
    );
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("suggestedValue");
    expect(serialized).not.toContain("/v2/users");
  });

  it("records immutable concerns as advisories, never executable operations", () => {
    const result = review([]);
    const parsed = parseModelItemOutput({
      advisories: [
        {
          advisoryId: "a1",
          code: OPTIMIZER_ADVISORY_CODES.SUSPECTED_METHOD,
          rationale: "POST may be more accurate.",
        },
        {
          advisoryId: "a2",
          code: OPTIMIZER_ADVISORY_CODES.SUSPECTED_AUTH,
          rationale: "The endpoint may require authentication.",
        },
        {
          advisoryId: "a3",
          code: OPTIMIZER_ADVISORY_CODES.MISSING_PARAMETER,
          rationale: "A cursor parameter may be missing.",
        },
      ],
    });
    const built = buildItemReview({
      snapshot: SNAPSHOT,
      definition: DEFINITION,
      operations: parsed.operations,
      preRejected: parsed.rejected,
      advisories: parsed.advisories,
      compile: COMPILE,
      existingToolNames: [],
    });
    expect(built.operations).toEqual([]);
    expect(built.advisories.map((a) => a.code)).toEqual([
      OPTIMIZER_ADVISORY_CODES.SUSPECTED_METHOD,
      OPTIMIZER_ADVISORY_CODES.SUSPECTED_AUTH,
      OPTIMIZER_ADVISORY_CODES.MISSING_PARAMETER,
    ]);
    void result;
  });
});
