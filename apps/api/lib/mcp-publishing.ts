/**
 * @file Pure publication candidate model shared by Studio, Platform MCP, and
 * the runtime. Builds deterministic, secret-safe fingerprints, structural
 * diffs, and readiness results from a draft aggregate. No database or network
 * I/O happens here.
 */
import {
  MCP_REVISION_COMPILER_VERSION,
  MCP_REVISION_SCHEMA_VERSION,
  type McpRevisionDiffSummary,
} from "@repo/db";
import {
  canonicalContractJson,
  contractFingerprint,
  MCP_CONTRACT_VERSION,
} from "./mcp-contract.js";
import type {
  McpBehaviorAnnotations,
  McpCompileIssue,
} from "./mcp-request-definition.js";

export type PublicationCommonEntries = {
  headers: Array<Record<string, unknown>>;
  query: Array<Record<string, unknown>>;
};

export type PublicationAuthConfiguration = Record<string, unknown>;

export type PublicationWarningCode =
  | "contract_changed"
  | "tool_added"
  | "tool_removed"
  | "tool_disabled"
  | "destructive_change"
  | "auth_changed"
  | "config_changed"
  | "unpublished_mutation";

export type PublicationTool = {
  sourceToolId: string;
  name: string;
  title: string | null;
  description: string | null;
  method: string;
  requestDefinition: Record<string, unknown> | null;
  compiledPlan: Record<string, unknown> | null;
  compileStatus: string | null;
  compileIssues: McpCompileIssue[];
  annotations: McpBehaviorAnnotations | null;
  allowMutation: boolean;
  enabled: boolean;
  source: string;
  contractFingerprint: string | null;
  definitionHash: string | null;
  toolOrder: number;
  /** Blocking compile error resolved while building the candidate. */
  compileError: {
    code: string;
    message: string;
    path?: string;
    nodeId?: string;
  } | null;
};

export type PublicationConfig = {
  sourceValueId: string;
  name: string;
  kind: "config" | "secret";
  owner: string | null;
  description: string | null;
  /** Config value snapshot; null for secret slots. */
  value: string | null;
};

export type PublicationServerFields = {
  name: string;
  description: string | null;
  baseUrl: string;
  allowedHosts: string[];
  /** Canonical JSON value; shape-validated before it reaches this model. */
  commonEntries: unknown;
  authConfiguration: unknown;
};

export type PublicationCandidate = {
  server: PublicationServerFields;
  tools: PublicationTool[];
  configs: PublicationConfig[];
  candidateFingerprint: string;
  contractFingerprint: string;
  enabledContracts: Array<{ name: string; fingerprint: string }>;
  errors: PublicationIssue[];
  warnings: PublicationIssue[];
  ready: boolean;
};

export type PublicationIssue = {
  severity: "error" | "warning";
  /** Stable machine code: an `APP_ERROR_CODES` value or a warning code. */
  code: string;
  message: string;
  path?: string;
  nodeId?: string;
  toolName?: string;
};

/** Active revision projection used for diffing and dirty-state comparison. */
export type ActiveRevisionSummary = {
  id: string;
  revisionNumber: number;
  candidateFingerprint: string;
  contractFingerprint: string;
  server: PublicationServerFields;
  tools: Array<{
    sourceToolId: string;
    name: string;
    enabled: boolean;
    allowMutation: boolean;
    method: string;
    contractFingerprint: string | null;
    definitionHash: string | null;
  }>;
  configs: Array<{
    sourceValueId: string;
    name: string;
    kind: "config" | "secret";
    value: string | null;
  }>;
};

function canonicalNullable(value: unknown): unknown {
  return value === undefined ? null : value;
}

function toComparableAuth(value: unknown): unknown {
  return canonicalNullable(value);
}

function toComparableCommon(value: unknown): unknown {
  return canonicalNullable(value);
}

/**
 * Canonical payload for the candidate fingerprint. Deliberately excludes
 * draft/config revision counters, actor/note/timestamp metadata, revision ids,
 * and all secret material, so an exact draft revert reproduces the active
 * fingerprint and secret rotation never changes revision identity.
 */
export function candidateFingerprintPayload(
  server: PublicationServerFields,
  tools: PublicationTool[],
  configs: PublicationConfig[],
): unknown {
  const orderedTools = [...tools].sort((a, b) =>
    a.sourceToolId < b.sourceToolId
      ? -1
      : a.sourceToolId > b.sourceToolId
        ? 1
        : 0,
  );
  const orderedConfigs = [...configs].sort((a, b) =>
    a.sourceValueId < b.sourceValueId
      ? -1
      : a.sourceValueId > b.sourceValueId
        ? 1
        : 0,
  );
  return {
    schemaVersion: MCP_REVISION_SCHEMA_VERSION,
    compilerVersion: MCP_REVISION_COMPILER_VERSION,
    server: {
      name: server.name,
      description: canonicalNullable(server.description),
      baseUrl: server.baseUrl,
      allowedHosts: [...server.allowedHosts].sort(),
      commonEntries: toComparableCommon(server.commonEntries),
      authConfiguration: toComparableAuth(server.authConfiguration),
    },
    tools: orderedTools.map((tool) => ({
      sourceToolId: tool.sourceToolId,
      name: tool.name,
      title: canonicalNullable(tool.title),
      description: canonicalNullable(tool.description),
      method: tool.method,
      requestDefinition: canonicalNullable(tool.requestDefinition),
      enabled: tool.enabled,
      allowMutation: tool.allowMutation,
      annotations: canonicalNullable(tool.annotations),
      source: tool.source,
      compileStatus: canonicalNullable(tool.compileStatus),
    })),
    configs: orderedConfigs.map((config) => ({
      sourceValueId: config.sourceValueId,
      name: config.name,
      kind: config.kind,
      owner: canonicalNullable(config.owner),
      value: config.kind === "secret" ? null : canonicalNullable(config.value),
    })),
  };
}

export function computeCandidateFingerprint(
  server: PublicationServerFields,
  tools: PublicationTool[],
  configs: PublicationConfig[],
): string {
  return contractFingerprint(
    candidateFingerprintPayload(server, tools, configs),
  );
}

/**
 * Aggregate agent-contract fingerprint. Only enabled, contract-ready tools
 * participate; ordering is by tool name so discovery and identity are stable.
 */
export function computeAggregateContractFingerprint(
  enabledContracts: Array<{ name: string; fingerprint: string }>,
): string {
  const sorted = [...enabledContracts].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  return contractFingerprint({
    contractVersion: MCP_CONTRACT_VERSION,
    tools: sorted.map((entry) => ({
      name: entry.name,
      fingerprint: entry.fingerprint,
    })),
  });
}

function canonicalServerField(value: unknown): unknown {
  return Array.isArray(value) ? [...value].sort() : canonicalNullable(value);
}

const SERVER_FIELD_LABELS: Array<[keyof PublicationServerFields, string]> = [
  ["name", "name"],
  ["description", "description"],
  ["baseUrl", "baseUrl"],
  ["allowedHosts", "allowedHosts"],
];

export type PublicationDiff = {
  summary: McpRevisionDiffSummary;
  changed: boolean;
  destructive: boolean;
};

/**
 * Secret-safe structural diff. Reports only categories and safe tool names;
 * never values, secret ids, bindings, or ciphertext.
 */
export function diffCandidateAgainstRevision(
  candidate: PublicationCandidate,
  active: ActiveRevisionSummary | null,
): PublicationDiff {
  if (!active) {
    const toolsAdded = candidate.tools.map((tool) => tool.name).sort();
    const destructive = candidate.tools.some(
      (tool) =>
        tool.enabled &&
        ["POST", "PUT", "PATCH", "DELETE"].includes(tool.method.toUpperCase()),
    );
    return {
      summary: {
        serverChanged: [],
        commonChanged: false,
        authChanged: false,
        toolsAdded,
        toolsRemoved: [],
        toolsChanged: [],
        toolsEnabled: [],
        toolsDisabled: [],
        configChanged: candidate.configs.length > 0,
        contractChanged: candidate.enabledContracts.length > 0,
      },
      changed: true,
      destructive,
    };
  }

  const serverChanged: string[] = [];
  for (const [field, label] of SERVER_FIELD_LABELS) {
    if (
      canonicalContractJson(canonicalServerField(candidate.server[field])) !==
      canonicalContractJson(canonicalServerField(active.server[field]))
    ) {
      serverChanged.push(label);
    }
  }

  const commonChanged =
    canonicalContractJson(
      toComparableCommon(candidate.server.commonEntries),
    ) !==
    canonicalContractJson(toComparableCommon(active.server.commonEntries));
  const authChanged =
    canonicalContractJson(
      toComparableAuth(candidate.server.authConfiguration),
    ) !==
    canonicalContractJson(toComparableAuth(active.server.authConfiguration));

  const activeByName = new Map(active.tools.map((tool) => [tool.name, tool]));
  const candidateByName = new Map(
    candidate.tools.map((tool) => [tool.name, tool]),
  );
  const toolsAdded: string[] = [];
  const toolsRemoved: string[] = [];
  const toolsChanged: string[] = [];
  const toolsEnabled: string[] = [];
  const toolsDisabled: string[] = [];
  let destructive = false;

  for (const tool of [...candidate.tools].sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const previous = activeByName.get(tool.name);
    if (!previous) {
      toolsAdded.push(tool.name);
      if (tool.enabled) {
        destructive = destructive || isDestructiveTool(tool);
      }
      continue;
    }
    if (previous.enabled !== tool.enabled) {
      if (tool.enabled) {
        toolsEnabled.push(tool.name);
        destructive = destructive || isDestructiveTool(tool);
      } else {
        toolsDisabled.push(tool.name);
      }
    }
    const identityChanged =
      previous.method.toUpperCase() !== tool.method.toUpperCase() ||
      previous.allowMutation !== tool.allowMutation ||
      previous.definitionHash !== tool.definitionHash ||
      previous.contractFingerprint !== tool.contractFingerprint;
    if (identityChanged) {
      toolsChanged.push(tool.name);
      if (tool.enabled && isDestructiveTool(tool)) {
        destructive = true;
      }
    }
  }

  for (const tool of active.tools) {
    if (!candidateByName.has(tool.name)) {
      toolsRemoved.push(tool.name);
      destructive = true;
    }
  }

  const changed =
    serverChanged.length > 0 ||
    commonChanged ||
    authChanged ||
    toolsAdded.length > 0 ||
    toolsRemoved.length > 0 ||
    toolsChanged.length > 0 ||
    toolsEnabled.length > 0 ||
    toolsDisabled.length > 0 ||
    candidate.candidateFingerprint !== active.candidateFingerprint;

  return {
    summary: {
      serverChanged: serverChanged.sort(),
      commonChanged,
      authChanged,
      toolsAdded: toolsAdded.sort(),
      toolsRemoved: toolsRemoved.sort(),
      toolsChanged: toolsChanged.sort(),
      toolsEnabled: toolsEnabled.sort(),
      toolsDisabled: toolsDisabled.sort(),
      configChanged: candidateFingerprintConfigChanged(candidate, active),
      contractChanged:
        candidate.contractFingerprint !== active.contractFingerprint,
    },
    changed,
    destructive,
  };
}

function candidateFingerprintConfigChanged(
  candidate: PublicationCandidate,
  active: ActiveRevisionSummary,
): boolean {
  const activeById = new Map(
    active.configs.map((config) => [config.sourceValueId, config]),
  );
  if (candidate.configs.length !== active.configs.length) return true;
  for (const config of candidate.configs) {
    const previous = activeById.get(config.sourceValueId);
    if (!previous) return true;
    if (
      previous.name !== config.name ||
      previous.kind !== config.kind ||
      (config.kind !== "secret" && previous.value !== config.value)
    ) {
      return true;
    }
  }
  return false;
}

function isDestructiveTool(tool: PublicationTool): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(tool.method.toUpperCase());
}

/**
 * Deterministic readiness for a candidate. Blocking errors prevent
 * publication; warnings require candidate-bound acknowledgement.
 */
export function deriveCandidateReadiness(candidate: PublicationCandidate): {
  errors: PublicationIssue[];
  warnings: PublicationIssue[];
} {
  const errors: PublicationIssue[] = [];
  const enabledTools = candidate.tools.filter((tool) => tool.enabled);
  if (enabledTools.length === 0) {
    errors.push({
      severity: "error",
      code: "MCP_PUBLISH_NOT_READY",
      message: "A publication requires at least one enabled, valid tool.",
    });
  }
  for (const tool of candidate.tools) {
    if (!tool.enabled) continue;
    if (tool.compileError) {
      errors.push({
        severity: "error",
        code: tool.compileError.code,
        message: tool.compileError.message,
        path: tool.compileError.path,
        nodeId: tool.compileError.nodeId,
        toolName: tool.name,
      });
      continue;
    }
    if (
      !tool.compiledPlan ||
      !tool.contractFingerprint ||
      tool.compileStatus !== "valid"
    ) {
      errors.push({
        severity: "error",
        code: "MCP_COMPILE_INVALID",
        message: `Enabled tool "${tool.name}" is not contract-ready.`,
        toolName: tool.name,
      });
      continue;
    }
    if (isDestructiveTool(tool) && !tool.allowMutation) {
      errors.push({
        severity: "error",
        code: "MCP_MUTATION_NOT_ALLOWED",
        message: `Enabled mutating tool "${tool.name}" is missing mutation permission.`,
        toolName: tool.name,
      });
    }
  }
  return { errors, warnings: candidate.warnings.slice() };
}
