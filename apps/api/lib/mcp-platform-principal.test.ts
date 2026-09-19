import { describe, expect, it } from "vitest";
import {
  APP_ERROR_CODES,
  MCP_DEFAULT_PLATFORM_SCOPES,
  MCP_PLATFORM_HIGH_RISK_SCOPES,
  MCP_PLATFORM_POLICY_VERSION,
  MCP_PLATFORM_SCOPE_DEPENDENCIES,
  MCP_PLATFORM_SCOPES,
  sortPlatformScopes,
  type McpPlatformScope,
} from "@repo/core";
import { AppError } from "./app-error.js";
import {
  buildPlatformPrincipal,
  invalidPlatformTokenError,
  isPlatformPrincipalPolicySupported,
  platformGrantFingerprint,
  validatePlatformGrantRequest,
} from "./mcp-platform-principal.js";
import { createPlatformPatCommandSchema } from "./mcp-domain-commands.js";

function scopeClosure(scope: McpPlatformScope): Set<McpPlatformScope> {
  const closure = new Set<McpPlatformScope>();
  const stack: McpPlatformScope[] = [scope];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || closure.has(current)) continue;
    closure.add(current);
    for (const dependency of MCP_PLATFORM_SCOPE_DEPENDENCIES[current]) {
      stack.push(dependency);
    }
  }
  return closure;
}

function isDependencySatisfied(scopes: readonly McpPlatformScope[]): boolean {
  const present = new Set(scopes);
  return scopes.every((scope) =>
    [...scopeClosure(scope)].every((dependency) => present.has(dependency)),
  );
}

const scopeCombinationCases = Array.from(
  { length: 1 << MCP_PLATFORM_SCOPES.length },
  (_, mask) => {
    const scopes = MCP_PLATFORM_SCOPES.filter(
      (_scope, index) => (mask & (1 << index)) !== 0,
    );
    return {
      label: scopes.length > 0 ? scopes.join("+") : "(empty)",
      scopes: [...scopes] as McpPlatformScope[],
      valid: isDependencySatisfied(scopes),
    };
  },
);

describe("validatePlatformGrantRequest", () => {
  it("accepts a read-only selected grant and canonically sorts scopes", () => {
    const grant = validatePlatformGrantRequest({
      scopes: ["read"],
      resourceMode: "selected",
      serverIds: ["mcs_b"],
    });
    expect(grant.scopes).toEqual(["read"]);
    expect(grant.resourceMode).toBe("selected");
    expect(grant.serverIds).toEqual(["mcs_b"]);
    expect(grant.highRisk).toBe(false);
  });

  it("deduplicates selected server ids", () => {
    const grant = validatePlatformGrantRequest({
      scopes: ["read"],
      resourceMode: "selected",
      serverIds: ["mcs_a", "mcs_a", "mcs_b"],
    });
    expect(grant.serverIds).toEqual(["mcs_a", "mcs_b"]);
  });

  it("rejects publish without author", () => {
    expect(() =>
      validatePlatformGrantRequest({
        scopes: ["read", "publish"],
        resourceMode: "selected",
        serverIds: ["mcs_a"],
      }),
    ).toThrowError(
      expect.objectContaining({
        appCode: APP_ERROR_CODES.MCP_PAT_SCOPE_INVALID,
      }),
    );
  });

  it("rejects invoke_mutation without invoke", () => {
    expect(() =>
      validatePlatformGrantRequest({
        scopes: ["read", "invoke_mutation"],
        resourceMode: "selected",
        serverIds: ["mcs_a"],
      }),
    ).toThrowError(
      expect.objectContaining({
        appCode: APP_ERROR_CODES.MCP_PAT_SCOPE_INVALID,
      }),
    );
  });

  it("rejects duplicate and unknown scopes", () => {
    for (const scopes of [
      ["read", "read"],
      ["read", "not_a_scope"],
    ]) {
      expect(() =>
        validatePlatformGrantRequest({
          scopes,
          resourceMode: "selected",
          serverIds: ["mcs_a"],
        }),
      ).toThrowError(
        expect.objectContaining({
          appCode: APP_ERROR_CODES.MCP_PAT_SCOPE_INVALID,
        }),
      );
    }
  });

  it("rejects resource-mode and server-grant mismatch", () => {
    expect(() =>
      validatePlatformGrantRequest({
        scopes: ["read"],
        resourceMode: "selected",
        serverIds: [],
      }),
    ).toThrowError(
      expect.objectContaining({ appCode: APP_ERROR_CODES.MCP_POLICY_CONFLICT }),
    );
    expect(() =>
      validatePlatformGrantRequest({
        scopes: ["read"],
        resourceMode: "account",
        serverIds: ["mcs_a"],
      }),
    ).toThrowError(
      expect.objectContaining({ appCode: APP_ERROR_CODES.MCP_POLICY_CONFLICT }),
    );
  });

  it("classifies account-wide and dangerous scopes as high risk", () => {
    const account = validatePlatformGrantRequest({
      scopes: ["read"],
      resourceMode: "account",
      serverIds: [],
    });
    expect(account.highRisk).toBe(true);

    const destructive = validatePlatformGrantRequest({
      scopes: ["read", "destructive"],
      resourceMode: "selected",
      serverIds: ["mcs_a"],
    });
    expect(destructive.highRisk).toBe(true);
  });
});

describe("platformGrantFingerprint", () => {
  it("is stable for equivalent grants and order-independent for scopes", () => {
    const a = platformGrantFingerprint({
      policyVersion: 1,
      scopes: ["read", "invoke"],
      resourceMode: "selected",
      serverIds: ["mcs_b", "mcs_a"],
    });
    const b = platformGrantFingerprint({
      policyVersion: 1,
      scopes: ["invoke", "read"],
      resourceMode: "selected",
      serverIds: ["mcs_a", "mcs_b"],
    });
    expect(a).toBe(b);
  });

  it("changes when the resource boundary changes", () => {
    const a = platformGrantFingerprint({
      policyVersion: 1,
      scopes: ["read"],
      resourceMode: "selected",
      serverIds: ["mcs_a"],
    });
    const b = platformGrantFingerprint({
      policyVersion: 1,
      scopes: ["read"],
      resourceMode: "selected",
      serverIds: ["mcs_b"],
    });
    expect(a).not.toBe(b);
  });

  it("changes with the policy version and the resource mode", () => {
    const base = {
      scopes: ["read"] as const,
      serverIds: [] as const,
    };
    const v1 = platformGrantFingerprint({
      policyVersion: 1,
      resourceMode: "account",
      ...base,
    });
    const v2 = platformGrantFingerprint({
      policyVersion: 2,
      resourceMode: "account",
      ...base,
    });
    const selected = platformGrantFingerprint({
      policyVersion: 1,
      resourceMode: "selected",
      scopes: ["read"],
      serverIds: ["mcs_a"],
    });
    expect(v1).not.toBe(v2);
    expect(v1).not.toBe(selected);
  });

  it("returns a sha256-prefixed digest", () => {
    expect(
      platformGrantFingerprint({
        policyVersion: MCP_PLATFORM_POLICY_VERSION,
        scopes: ["read"],
        resourceMode: "account",
        serverIds: [],
      }),
    ).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("validatePlatformGrantRequest scope dependency matrix", () => {
  it.each(scopeCombinationCases)(
    "scope set $label is valid=$valid",
    ({ scopes, valid }) => {
      const build = () =>
        validatePlatformGrantRequest({
          scopes,
          resourceMode: "selected",
          serverIds: ["mcs_a"],
        });

      if (!valid) {
        expect(build).toThrowError(
          expect.objectContaining({
            appCode: APP_ERROR_CODES.MCP_PAT_SCOPE_INVALID,
          }),
        );
        return;
      }

      const grant = build();
      const canonical = sortPlatformScopes(scopes);
      expect(grant.scopes).toEqual(canonical);
      expect(grant.scopes.every((scope) => scopes.includes(scope))).toBe(true);
    },
  );

  it.each(MCP_PLATFORM_SCOPES.map((scope) => [scope] as const))(
    "rejects a duplicated %s scope row",
    (scope) => {
      expect(() =>
        validatePlatformGrantRequest({
          scopes: [scope, scope],
          resourceMode: "account",
          serverIds: [],
        }),
      ).toThrowError(
        expect.objectContaining({
          appCode: APP_ERROR_CODES.MCP_PAT_SCOPE_INVALID,
        }),
      );
    },
  );

  it.each([
    "",
    "Read",
    "READ",
    " read",
    "read ",
    "admin",
    "__proto__",
    "destructive!",
    "invoke-mutation",
  ])("rejects the unknown scope %j", (scope) => {
    expect(() =>
      validatePlatformGrantRequest({
        scopes: ["read", scope],
        resourceMode: "account",
        serverIds: [],
      }),
    ).toThrowError(
      expect.objectContaining({
        appCode: APP_ERROR_CODES.MCP_PAT_SCOPE_INVALID,
      }),
    );
  });

  it.each(MCP_PLATFORM_SCOPES.map((scope) => [scope] as const))(
    "accepts %s alone only when its full dependency closure is implied",
    (scope) => {
      const scopes = [scope];
      const build = () =>
        validatePlatformGrantRequest({
          scopes,
          resourceMode: "selected",
          serverIds: ["mcs_a"],
        });

      if (isDependencySatisfied(scopes)) {
        expect(build).not.toThrow();
      } else {
        expect(build).toThrowError(
          expect.objectContaining({
            appCode: APP_ERROR_CODES.MCP_PAT_SCOPE_INVALID,
          }),
        );
      }
    },
  );

  it("accepts transitive dependency closures", () => {
    for (const scope of MCP_PLATFORM_SCOPES) {
      const closure = [...scopeClosure(scope)];
      const grant = validatePlatformGrantRequest({
        scopes: closure,
        resourceMode: "selected",
        serverIds: ["mcs_a"],
      });
      expect(grant.scopes).toEqual(sortPlatformScopes(closure));
    }
  });

  it("rejects the documented direct-dependency violations", () => {
    const cases: Array<[McpPlatformScope, McpPlatformScope[]]> = [
      ["author", ["read", "publish"]],
      ["read", ["author", "publish"]],
      ["invoke", ["read", "invoke_mutation"]],
      ["read", ["invoke", "invoke_mutation"]],
      ["read", ["observe"]],
      ["read", ["author"]],
      ["read", ["invoke"]],
      ["read", ["secret_reference"]],
      ["read", ["destructive"]],
    ];
    for (const [missing, scopes] of cases) {
      expect(() =>
        validatePlatformGrantRequest({
          scopes,
          resourceMode: "selected",
          serverIds: ["mcs_a"],
        }),
      ).toThrowError(
        expect.objectContaining({
          appCode: APP_ERROR_CODES.MCP_PAT_SCOPE_INVALID,
          details: expect.objectContaining({ scopes: [missing] }),
        }),
      );
    }
  });
});

describe("validatePlatformGrantRequest resource boundaries", () => {
  it("rejects selected mode without any server id", () => {
    expect(() =>
      validatePlatformGrantRequest({
        scopes: ["read"],
        resourceMode: "selected",
        serverIds: [],
      }),
    ).toThrowError(
      expect.objectContaining({ appCode: APP_ERROR_CODES.MCP_POLICY_CONFLICT }),
    );
  });

  it("rejects account mode that declares selected servers", () => {
    expect(() =>
      validatePlatformGrantRequest({
        scopes: ["read"],
        resourceMode: "account",
        serverIds: ["mcs_a"],
      }),
    ).toThrowError(
      expect.objectContaining({ appCode: APP_ERROR_CODES.MCP_POLICY_CONFLICT }),
    );
  });

  it.each([undefined, null, "workspace", "global", "", 42, true, {}, []])(
    "rejects the invalid resource mode %j",
    (resourceMode) => {
      expect(() =>
        validatePlatformGrantRequest({
          scopes: ["read"],
          resourceMode,
          serverIds: [],
        }),
      ).toThrowError(
        expect.objectContaining({
          appCode: APP_ERROR_CODES.MCP_POLICY_CONFLICT,
        }),
      );
    },
  );

  it("deduplicates selected servers and drops unusable ids", () => {
    const grant = validatePlatformGrantRequest({
      scopes: ["read"],
      resourceMode: "selected",
      serverIds: ["mcs_a", "mcs_a", "", 5, null, undefined, "mcs_b"],
    });
    expect(grant.serverIds).toEqual(["mcs_a", "mcs_b"]);
  });

  it("keeps account-wide grants free of server ids", () => {
    const grant = validatePlatformGrantRequest({
      scopes: ["read"],
      resourceMode: "account",
    });
    expect(grant.serverIds).toEqual([]);
    expect(grant.highRisk).toBe(true);
  });
});

describe("validatePlatformGrantRequest risk classification", () => {
  it.each(MCP_PLATFORM_HIGH_RISK_SCOPES)(
    "classifies %s as high risk in selected mode",
    (scope) => {
      const scopes = [...scopeClosure(scope)];
      const grant = validatePlatformGrantRequest({
        scopes,
        resourceMode: "selected",
        serverIds: ["mcs_a"],
      });
      expect(grant.highRisk).toBe(true);
    },
  );

  it("does not classify a read-only selected grant as high risk", () => {
    for (const scopes of [["read"], ["read", "observe"], ["read", "author"]]) {
      const grant = validatePlatformGrantRequest({
        scopes,
        resourceMode: "selected",
        serverIds: ["mcs_a"],
      });
      expect(grant.highRisk).toBe(false);
    }
  });
});

describe("isPlatformPrincipalPolicySupported", () => {
  it("supports the current policy version", () => {
    expect(
      isPlatformPrincipalPolicySupported(MCP_PLATFORM_POLICY_VERSION),
    ).toBe(true);
  });

  it.each([0, 2, 3, -1, 1.5, NaN])(
    "does not support the policy version %s",
    (policyVersion) => {
      expect(isPlatformPrincipalPolicySupported(policyVersion)).toBe(false);
    },
  );

  it("records the supplied policy version in the grant and fingerprint", () => {
    const current = validatePlatformGrantRequest({
      scopes: ["read"],
      resourceMode: "account",
      serverIds: [],
    });
    const future = validatePlatformGrantRequest(
      { scopes: ["read"], resourceMode: "account", serverIds: [] },
      2,
    );
    expect(current.policyVersion).toBe(MCP_PLATFORM_POLICY_VERSION);
    expect(future.policyVersion).toBe(2);
    expect(future.fingerprint).not.toBe(
      platformGrantFingerprint({
        policyVersion: MCP_PLATFORM_POLICY_VERSION,
        scopes: ["read"],
        resourceMode: "account",
        serverIds: [],
      }),
    );
  });
});

describe("invalidPlatformTokenError", () => {
  it("is a uniform unauthenticated AppError", () => {
    const error = invalidPlatformTokenError();
    expect(error).toBeInstanceOf(AppError);
    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID);
    expect(error.status).toBe(401);
    expect(error.message).toBe("Agent token is invalid.");
  });

  it("keeps the cause out of the public message", () => {
    const cause = new Error("database exploded");
    const error = invalidPlatformTokenError(cause);
    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain("database exploded");
  });
});

describe("buildPlatformPrincipal", () => {
  it("freezes the principal and canonically sorts scopes", () => {
    const principal = buildPlatformPrincipal({
      tokenId: "mtk_1",
      userId: "usr_1",
      tokenName: "Agent",
      tokenPrefix: "rmcp_abc",
      policyVersion: 1,
      scopes: ["invoke", "read"],
      resourceMode: "selected",
      allowedServerIds: ["mcs_b", "mcs_a", "mcs_a"],
      expiresAt: null,
    });
    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.isFrozen(principal.scopes)).toBe(true);
    expect(Object.isFrozen(principal.allowedServerIds)).toBe(true);
    expect(principal.scopes).toEqual(["read", "invoke"]);
    expect(principal.allowedServerIds).toEqual(["mcs_b", "mcs_a"]);
  });

  it("never broadens an account principal to selected servers", () => {
    const principal = buildPlatformPrincipal({
      tokenId: "mtk_1",
      userId: "usr_1",
      tokenName: "Agent",
      tokenPrefix: "rmcp_abc",
      policyVersion: 1,
      scopes: ["read"],
      resourceMode: "account",
      allowedServerIds: ["mcs_a", "mcs_b"],
      expiresAt: null,
    });
    expect(principal.allowedServerIds).toEqual([]);
  });
});

describe("malformed grants never broaden access", () => {
  it("only ever returns scopes drawn from the requested set", () => {
    for (const { scopes, valid } of scopeCombinationCases) {
      if (!valid) continue;
      const grant = validatePlatformGrantRequest({
        scopes,
        resourceMode: "selected",
        serverIds: ["mcs_a"],
      });
      for (const scope of grant.scopes) {
        expect(scopes).toContain(scope);
      }
    }
  });

  it("throws instead of returning a partially repaired grant", () => {
    for (const { scopes, valid } of scopeCombinationCases) {
      if (valid) continue;
      let returned: unknown = "not-thrown";
      try {
        returned = validatePlatformGrantRequest({
          scopes,
          resourceMode: "selected",
          serverIds: ["mcs_a"],
        });
      } catch {
        returned = undefined;
      }
      expect(returned).toBeUndefined();
    }
  });

  it("does not coerce an unknown scope string into a known scope", () => {
    expect(() =>
      validatePlatformGrantRequest({
        scopes: ["read", "Author"],
        resourceMode: "account",
        serverIds: [],
      }),
    ).toThrowError(
      expect.objectContaining({
        appCode: APP_ERROR_CODES.MCP_PAT_SCOPE_INVALID,
      }),
    );
  });
});

describe("createPlatformPatCommandSchema defaults", () => {
  it("defaults new tokens to read-only and requires name and resource mode", () => {
    const parsed = createPlatformPatCommandSchema.parse({
      name: "Agent",
      resourceMode: "account",
    });
    expect(parsed.scopes).toEqual([...MCP_DEFAULT_PLATFORM_SCOPES]);
    expect(parsed.scopes).toEqual(["read"]);

    expect(
      createPlatformPatCommandSchema.safeParse({ resourceMode: "account" })
        .success,
    ).toBe(false);
    expect(
      createPlatformPatCommandSchema.safeParse({ name: "Agent" }).success,
    ).toBe(false);
  });
});
