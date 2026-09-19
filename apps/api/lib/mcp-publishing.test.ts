import { describe, expect, it } from "vitest";
import type { McpServer, McpServerVariable, McpTool } from "@repo/db";
import {
  computeAggregateContractFingerprint,
  diffCandidateAgainstRevision,
  type ActiveRevisionSummary,
  type PublicationCandidate,
} from "./mcp-publishing.js";
import {
  buildPublicationCandidate,
  type DraftAggregate,
} from "../services/mcp-publishing-service.js";

const CREATED = new Date("2024-01-01T00:00:00.000Z");

function definitionFor(path: string): Record<string, unknown> {
  return {
    version: 1,
    pathSegments: [{ id: "path_1", value: { kind: "literal", value: path } }],
    query: [
      {
        id: "q_region",
        name: "region",
        value: { kind: "serverValue", serverValueId: "msv_config" },
      },
    ],
    headers: [
      {
        id: "hdr_auth",
        name: "Authorization",
        value: {
          kind: "serverValue",
          serverValueId: "msv_secret",
          prefix: "Bearer ",
        },
      },
    ],
    body: { bodyType: "none" },
    agentInputs: [],
  };
}

const listContactsDefinition = definitionFor("/contacts");

const listCompaniesDefinition = definitionFor("/companies");

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: "mcs_unit",
    userId: "usr_unit",
    name: "Unit server",
    slug: "unit-server",
    description: null,
    iconAssetId: null,
    baseUrl: "https://api.example.com/v1",
    allowedHosts: ["api.example.com"],
    defaultHeaders: null,
    defaultQuery: null,
    commonEntries: { headers: [], query: [] },
    authConfiguration: null,
    status: "draft",
    configRevision: 1,
    draftRevision: 1,
    publishedRevisionId: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

function makeTool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    id: "mct_a",
    serverId: "mcs_unit",
    name: "list_contacts",
    title: "List contacts",
    description: "List contacts.",
    method: "GET",
    pathTemplate: "/contacts",
    requestTemplate: null,
    params: null,
    requestDefinition: listContactsDefinition,
    compiledPlan: null,
    compileStatus: null,
    compileIssues: null,
    annotations: null,
    allowMutation: false,
    enabled: true,
    source: "manual",
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

function makeValue(
  overrides: Partial<McpServerVariable> = {},
): McpServerVariable {
  return {
    id: "msv_config",
    serverId: "mcs_unit",
    name: "region",
    isSecret: false,
    kind: "config",
    owner: "manual",
    description: null,
    value: "mx",
    ciphertext: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

function makeAggregate(
  overrides: Partial<DraftAggregate> = {},
): DraftAggregate {
  return {
    server: makeServer(),
    tools: [makeTool()],
    values: [makeValue()],
    ...overrides,
  };
}

function candidateOf(aggregate: DraftAggregate): PublicationCandidate {
  return buildPublicationCandidate(aggregate);
}

function fingerprintOf(aggregate: DraftAggregate): string {
  return candidateOf(aggregate).candidateFingerprint;
}

describe("canonical publication candidate", () => {
  it("treats tool row order as insignificant", () => {
    const toolA = makeTool({ id: "mct_a", name: "list_contacts" });
    const toolB = makeTool({
      id: "mct_b",
      name: "list_companies",
      pathTemplate: "/companies",
      requestDefinition: listCompaniesDefinition,
    });
    const forward = fingerprintOf(makeAggregate({ tools: [toolA, toolB] }));
    const reversed = fingerprintOf(makeAggregate({ tools: [toolB, toolA] }));
    expect(forward).toBe(reversed);
  });

  it("treats equivalent JSON key order as insignificant", () => {
    const reordered: Record<string, unknown> = {
      body: { bodyType: "none" },
      agentInputs: [],
      headers: [
        {
          value: {
            serverValueId: "msv_secret",
            prefix: "Bearer ",
            kind: "serverValue",
          },
          name: "Authorization",
          id: "hdr_auth",
        },
      ],
      query: [
        {
          name: "region",
          value: { serverValueId: "msv_config", kind: "serverValue" },
          id: "q_region",
        },
      ],
      pathSegments: [
        { value: { value: "/contacts", kind: "literal" }, id: "path_1" },
      ],
      version: 1,
    };
    const canonical = fingerprintOf(makeAggregate());
    const shuffled = fingerprintOf(
      makeAggregate({ tools: [makeTool({ requestDefinition: reordered })] }),
    );
    expect(shuffled).toBe(canonical);
  });

  it("treats nullable and omitted defaults as equivalent", () => {
    const canonical = fingerprintOf(makeAggregate());
    const omitted = fingerprintOf(
      makeAggregate({
        server: makeServer({ description: undefined }),
        tools: [
          makeTool({ annotations: undefined, requestTemplate: undefined }),
        ],
      }),
    );
    expect(omitted).toBe(canonical);
  });

  it("changes the fingerprint for a tool definition change", () => {
    const canonical = fingerprintOf(makeAggregate());
    const changed = fingerprintOf(
      makeAggregate({
        tools: [
          makeTool({
            pathTemplate: "/companies",
            requestDefinition: listCompaniesDefinition,
          }),
        ],
      }),
    );
    expect(changed).not.toBe(canonical);
  });

  it("changes the fingerprint when a tool is enabled or disabled", () => {
    const enabled = fingerprintOf(makeAggregate());
    const disabled = fingerprintOf(
      makeAggregate({ tools: [makeTool({ enabled: false })] }),
    );
    expect(disabled).not.toBe(enabled);
  });

  it("changes the fingerprint when allowMutation changes", () => {
    const readOnly = fingerprintOf(makeAggregate());
    const mutating = fingerprintOf(
      makeAggregate({ tools: [makeTool({ allowMutation: true })] }),
    );
    expect(mutating).not.toBe(readOnly);
  });

  it("changes the fingerprint when a config value changes", () => {
    const original = fingerprintOf(makeAggregate());
    const changed = fingerprintOf(
      makeAggregate({
        values: [makeValue({ value: "us" })],
      }),
    );
    expect(changed).not.toBe(original);
  });

  it("changes the fingerprint when secret structure changes", () => {
    const withoutSecret = fingerprintOf(makeAggregate());
    const withSecret = fingerprintOf(
      makeAggregate({
        values: [
          makeValue(),
          makeValue({
            id: "msv_secret",
            name: "api_token",
            kind: "secret",
            isSecret: true,
            value: null,
            ciphertext: "envelope-1",
          }),
        ],
      }),
    );
    expect(withSecret).not.toBe(withoutSecret);

    const renamedSecret = fingerprintOf(
      makeAggregate({
        values: [
          makeValue(),
          makeValue({
            id: "msv_secret",
            name: "auth_token",
            kind: "secret",
            isSecret: true,
            value: null,
            ciphertext: "envelope-1",
          }),
        ],
      }),
    );
    expect(renamedSecret).not.toBe(withSecret);
  });

  it("does not change the fingerprint when secret material rotates", () => {
    const base = makeAggregate({
      values: [
        makeValue(),
        makeValue({
          id: "msv_secret",
          name: "api_token",
          kind: "secret",
          isSecret: true,
          value: null,
          ciphertext: "envelope-v1",
        }),
      ],
    });
    const rotated = makeAggregate({
      values: [
        makeValue(),
        makeValue({
          id: "msv_secret",
          name: "api_token",
          kind: "secret",
          isSecret: true,
          value: "plaintext-should-be-ignored",
          ciphertext: "envelope-v2",
        }),
      ],
    });
    expect(fingerprintOf(rotated)).toBe(fingerprintOf(base));
  });

  it("includes only enabled valid tools in the aggregate contract fingerprint", () => {
    const validTool = makeTool({ id: "mct_a", name: "list_contacts" });
    const validOther = makeTool({
      id: "mct_b",
      name: "list_companies",
      pathTemplate: "/companies",
      requestDefinition: listCompaniesDefinition,
    });
    const disabled = makeTool({
      id: "mct_c",
      name: "list_disabled",
      pathTemplate: "/disabled",
      requestDefinition: {
        version: 1,
        pathSegments: [
          { id: "path_1", value: { kind: "literal", value: "/disabled" } },
        ],
        query: [],
        headers: [],
        body: { bodyType: "none" },
        agentInputs: [],
      },
      enabled: false,
    });

    const values = [
      makeValue(),
      makeValue({
        id: "msv_secret",
        name: "api_token",
        kind: "secret",
        isSecret: true,
        value: null,
      }),
    ];
    const base = candidateOf(
      makeAggregate({ tools: [validTool, validOther], values }),
    );
    expect(base.enabledContracts.map((entry) => entry.name)).toEqual([
      "list_contacts",
      "list_companies",
    ]);

    const withDisabled = candidateOf(
      makeAggregate({ tools: [validTool, validOther, disabled], values }),
    );
    expect(withDisabled.contractFingerprint).toBe(base.contractFingerprint);
    expect(withDisabled.candidateFingerprint).not.toBe(
      base.candidateFingerprint,
    );
  });

  it("is order-independent by tool name at the contract level", () => {
    const a = { name: "list_contacts", fingerprint: "sha256:aaa" };
    const b = { name: "list_companies", fingerprint: "sha256:bbb" };
    expect(computeAggregateContractFingerprint([a, b])).toBe(
      computeAggregateContractFingerprint([b, a]),
    );
  });
});

describe("candidate readiness", () => {
  it("excludes auth-owned keys from legacy common entries", () => {
    const candidate = candidateOf(
      makeAggregate({
        server: makeServer({
          commonEntries: null,
          defaultHeaders: { Authorization: "Bearer fixed", "X-Trace": "1" },
          authConfiguration: {
            kind: "bearer",
            bindings: [
              {
                location: "header",
                key: "Authorization",
                serverValueId: "msv_secret",
              },
            ],
          },
        }),
        tools: [
          makeTool({
            requestDefinition: {
              version: 1,
              pathSegments: [
                {
                  id: "path_1",
                  value: { kind: "literal", value: "/contacts" },
                },
              ],
              query: [
                {
                  id: "q_region",
                  name: "region",
                  value: { kind: "serverValue", serverValueId: "msv_config" },
                },
              ],
              headers: [],
              body: { bodyType: "none" },
              agentInputs: [],
            },
          }),
        ],
        values: [
          makeValue(),
          makeValue({
            id: "msv_secret",
            name: "api_token",
            kind: "secret",
            isSecret: true,
            value: null,
          }),
        ],
      }),
    );

    // The auth-owned Authorization header must not be re-injected as a common
    // entry, otherwise the candidate compiles as invalid and publish deadlocks.
    expect(candidate.ready).toBe(true);
    const common = candidate.server.commonEntries as {
      headers: Array<{ name: string }>;
    };
    expect(common.headers.map((header) => header.name)).toEqual(["X-Trace"]);
  });
});

describe("secret-safe candidate projection", () => {
  const secretValue = "super-secret-token-value";
  const secretCiphertext = "enc:v1:secret-ciphertext-envelope";

  function secretAggregate(): DraftAggregate {
    return makeAggregate({
      tools: [makeTool()],
      values: [
        makeValue({ id: "msv_config", name: "region", value: "mx" }),
        makeValue({
          id: "msv_secret",
          name: "api_token",
          kind: "secret",
          isSecret: true,
          value: secretValue,
          ciphertext: secretCiphertext,
        }),
      ],
    });
  }

  it("stores null for secret slots while retaining config values", () => {
    const candidate = candidateOf(secretAggregate());
    const secret = candidate.configs.find(
      (config) => config.sourceValueId === "msv_secret",
    );
    const config = candidate.configs.find(
      (config) => config.sourceValueId === "msv_config",
    );
    expect(secret).toMatchObject({ isSecret: true, value: null });
    expect(config).toMatchObject({ isSecret: false, value: "mx" });
    expect(JSON.stringify(candidate.configs)).not.toContain(secretValue);
    expect(JSON.stringify(candidate.configs)).not.toContain(secretCiphertext);
  });

  it("produces a diff containing only categories and safe tool names", () => {
    const candidate = candidateOf(secretAggregate());
    const active: ActiveRevisionSummary = {
      id: "msr_active",
      revisionNumber: 1,
      candidateFingerprint: candidate.candidateFingerprint,
      contractFingerprint: candidate.contractFingerprint,
      server: {
        name: "Unit server",
        description: null,
        baseUrl: "https://api.example.com/v1",
        allowedHosts: ["api.example.com"],
        commonEntries: { headers: [], query: [] },
        authConfiguration: null,
      },
      tools: [],
      configs: [],
    };

    const diff = diffCandidateAgainstRevision(candidate, active);
    const serialized = JSON.stringify(diff);
    expect(diff.summary.toolsAdded).toEqual(["list_contacts"]);
    expect(serialized).not.toContain(secretValue);
    expect(serialized).not.toContain(secretCiphertext);
    expect(serialized).not.toContain("Bearer ");
    expect(serialized).not.toContain("msv_secret");
    expect(serialized).toContain("list_contacts");
  });
});
