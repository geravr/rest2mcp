/**
 * @file Publication lifecycle: draft aggregate loading, candidate building,
 * preview, atomic publish, revision history/detail, restore-to-draft, and
 * bounded retention. This is the only module that writes revision tables.
 */
import {
  generateId,
  mcpServer,
  mcpServerRevision,
  mcpServerRevisionConfig,
  mcpServerRevisionTool,
  mcpServerVariable,
  mcpTool,
  mcpToolGroup,
  MCP_REVISION_COMPILER_VERSION,
  MCP_REVISION_SCHEMA_VERSION,
  type McpRevisionActorSource,
  type McpRevisionDiffSummary,
  type McpServer,
  type McpServerRevision,
  type McpServerVariable,
  type McpTool,
  type NewMcpServerRevision,
} from "@repo/db";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { APP_ERROR_CODES, AppError, appError } from "../lib/app-error.js";
import { getMcpMaxToolsPerServer } from "../lib/mcp-limits.js";
import {
  captureMcpTelemetry,
  MCP_TELEMETRY_EVENTS,
} from "../lib/mcp-telemetry.js";
import {
  compileToolDefinition,
  type CompileServerValueRef,
} from "../lib/mcp-compiler.js";
import { compileAgentToolContract } from "../lib/mcp-contract.js";
import {
  computeAggregateContractFingerprint,
  computeCandidateFingerprint,
  deriveCandidateReadiness,
  diffCandidateAgainstRevision,
  type ActiveRevisionSummary,
  type PublicationCandidate,
  type PublicationConfig,
  type PublicationDiff,
  type PublicationIssue,
  type PublicationTool,
} from "../lib/mcp-publishing.js";
import {
  mcpAuthConfigurationSchema,
  mcpCommonEntriesSchema,
  mcpRequestDefinitionSchema,
  scanDefinitionIds,
  type McpAuthConfiguration,
  type McpCommonEntries,
  type McpCompileIssue,
} from "../lib/mcp-request-definition.js";
import { parseOpenApiSourceProvenance } from "../lib/openapi-import-contracts.js";
import { paginate } from "../lib/paginate.js";
import type { McpExecutionSnapshot } from "./mcp-executor-service.js";
import { loadExecutionSnapshot } from "./mcp-executor-service.js";
import { isRetryableTransactionError } from "./mcp-server-command.js";
import type { PaginationInput } from "@repo/core";

type DB = PostgresJsDatabase<Record<string, unknown>>;

const PUBLISH_MAX_ATTEMPTS = 3;
const RETENTION_MINIMUM_RETAINED = 20;
const RETENTION_MAX_AGE_DAYS = 90;

/** Stable publish conflict codes safe to report as bounded telemetry labels. */
const PUBLISH_CONFLICT_CODES: ReadonlySet<string> = new Set([
  APP_ERROR_CODES.MCP_PUBLISH_STALE_DRAFT,
  APP_ERROR_CODES.MCP_PUBLISH_STALE_REVISION,
  APP_ERROR_CODES.MCP_PUBLISH_CANDIDATE_CHANGED,
  APP_ERROR_CODES.MCP_PUBLISH_NOT_READY,
  APP_ERROR_CODES.MCP_PUBLISH_WARNINGS_UNACKNOWLEDGED,
  APP_ERROR_CODES.MCP_PUBLISH_NO_CHANGES,
  APP_ERROR_CODES.MCP_PUBLISH_IDEMPOTENCY_CONFLICT,
]);

export type DraftAggregate = {
  server: McpServer;
  tools: McpTool[];
  values: McpServerVariable[];
};

export type PublishPreview = {
  serverId: string;
  draftRevision: number;
  publishedRevisionId: string | null;
  publishedRevisionNumber: number | null;
  candidateFingerprint: string;
  contractFingerprint: string;
  ready: boolean;
  dirty: boolean;
  errors: PublicationIssue[];
  warnings: PublicationIssue[];
  warningCodes: string[];
  diff: McpRevisionDiffSummary & { changed: boolean; destructive: boolean };
};

export type PublishServerInput = {
  userId: string;
  serverId: string;
  expectedDraftRevision: number;
  expectedPublishedRevisionId: string | null;
  publishRequestId: string;
  candidateFingerprint: string;
  acknowledgedWarningCodes?: string[];
  actorSource: McpRevisionActorSource;
  note?: string | null;
};

export type PublishResult = {
  serverId: string;
  revisionId: string;
  revisionNumber: number;
  candidateFingerprint: string;
  contractFingerprint: string;
  sourceDraftRevision: number;
  status: string;
  configRevision: number;
  idempotent: boolean;
};

export type RevisionSummary = {
  id: string;
  revisionNumber: number;
  sourceDraftRevision: number;
  candidateFingerprint: string;
  contractFingerprint: string;
  actorSource: string;
  note: string | null;
  isActive: boolean;
  createdAt: Date;
};

export type RevisionDetail = RevisionSummary & {
  schemaVersion: number;
  compilerVersion: string;
  server: {
    name: string;
    description: string | null;
    baseUrl: string;
    allowedHosts: string[];
  };
  diffSummary: McpRevisionDiffSummary | null;
  tools: Array<{
    sourceToolId: string;
    name: string;
    title: string | null;
    description: string | null;
    method: string;
    enabled: boolean;
    allowMutation: boolean;
    source: string;
    contractFingerprint: string | null;
    definitionHash: string | null;
    compileStatus: string | null;
    compileIssueCount: number;
  }>;
  configs: Array<{
    sourceValueId: string;
    name: string;
    kind: string;
    owner: string | null;
    /** Never the value: detail surfaces existence and category only. */
    hasValue: boolean;
    /** A referenced secret slot still exists as a current operational slot. */
    available: boolean;
  }>;
  /** Number of secret slots this revision references that no longer exist. */
  missingSecretCount: number;
};

export type RestoreRevisionInput = {
  userId: string;
  serverId: string;
  revisionId: string;
  expectedRevision: number;
  expectedDraftRevision: number;
};

export type RestoreRevisionResult = {
  serverId: string;
  revisionId: string;
  draftRevision: number;
  configRevision: number;
  missingSecretCount: number;
  toolCount: number;
};

function parseCommonEntries(server: McpServer): McpCommonEntries {
  const parsed = mcpCommonEntriesSchema.safeParse(server.commonEntries);
  return parsed.success ? parsed.data : { headers: [], query: [] };
}

function parseAuthConfiguration(raw: unknown): McpAuthConfiguration | null {
  if (!raw) return null;
  const parsed = mcpAuthConfigurationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function loadDraftAggregate(
  db: DB,
  input: { userId: string; serverId: string },
): Promise<DraftAggregate> {
  const [server] = await db
    .select()
    .from(mcpServer)
    .where(
      and(eq(mcpServer.id, input.serverId), eq(mcpServer.userId, input.userId)),
    )
    .limit(1);
  if (!server) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
      message: "MCP server not found.",
      status: 404,
    });
  }
  const tools = await db
    .select()
    .from(mcpTool)
    .where(eq(mcpTool.serverId, server.id))
    .orderBy(asc(mcpTool.createdAt));
  const values = await db
    .select()
    .from(mcpServerVariable)
    .where(eq(mcpServerVariable.serverId, server.id))
    .orderBy(asc(mcpServerVariable.createdAt));
  return { server, tools, values };
}

function resolveValueKind(row: McpServerVariable): "config" | "secret" {
  return row.kind as "config" | "secret";
}

function buildCandidateTools(
  aggregate: DraftAggregate,
  serverValueRefs: CompileServerValueRef[],
  common: McpCommonEntries,
  auth: McpAuthConfiguration | null,
  basePath: string,
): PublicationTool[] {
  const knownValueIds = new Set(serverValueRefs.map((ref) => ref.id));
  return aggregate.tools.map((tool, index) => {
    const base: PublicationTool = {
      sourceToolId: tool.id,
      name: tool.name,
      title: tool.title ?? null,
      description: tool.description ?? null,
      method: tool.method,
      requestDefinition:
        (tool.requestDefinition as Record<string, unknown> | null) ?? null,
      compiledPlan: null,
      compileStatus: tool.compileStatus,
      compileIssues: (tool.compileIssues as McpCompileIssue[] | null) ?? [],
      annotations: (tool.annotations as PublicationTool["annotations"]) ?? null,
      allowMutation: tool.allowMutation,
      enabled: tool.enabled,
      source: tool.source,
      contractFingerprint: null,
      definitionHash: null,
      toolOrder: index,
      compileError: null,
    };

    const parsedDefinition = mcpRequestDefinitionSchema.safeParse(
      tool.requestDefinition,
    );
    if (!parsedDefinition.success) {
      base.compileStatus = "invalid";
      base.compileError = {
        code: APP_ERROR_CODES.MCP_COMPILE_INVALID,
        message: `Tool "${tool.name}" has no valid typed request definition.`,
        path: "requestDefinition",
      };
      return base;
    }

    const definition = parsedDefinition.data;
    const scan = scanDefinitionIds(definition);
    const missing = scan.serverValueRefs.filter(
      (ref) => !knownValueIds.has(ref.id),
    );
    if (missing.length > 0) {
      base.compileStatus = "invalid";
      base.compileError = {
        code: APP_ERROR_CODES.MCP_PUBLISH_MISSING_SECRET,
        message: `Tool "${tool.name}" references a server value that no longer exists.`,
        path: missing[0]?.path,
      };
      return base;
    }

    const compileResult = compileToolDefinition({
      method: tool.method,
      definition,
      common,
      auth,
      serverValues: serverValueRefs,
      basePath,
      allowMutation: tool.allowMutation,
    });
    if (!compileResult.ok || !compileResult.plan) {
      const firstError =
        compileResult.issues.find((issue) => issue.severity === "error") ??
        compileResult.issues[0];
      base.compileStatus = "invalid";
      base.compileIssues = compileResult.issues;
      base.compileError = {
        code: APP_ERROR_CODES.MCP_COMPILE_INVALID,
        message:
          firstError?.message ?? `Tool "${tool.name}" failed to compile.`,
        path: firstError?.path,
        nodeId: firstError?.id,
      };
      return base;
    }

    const contractResult = compileAgentToolContract({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      method: tool.method,
      plan: compileResult.plan,
      baseIssues: compileResult.issues,
    });
    base.compiledPlan = compileResult.plan as unknown as Record<
      string,
      unknown
    >;
    base.compileIssues = contractResult.issues;
    base.definitionHash = compileResult.plan.definitionHash;
    if (!contractResult.ok || !contractResult.contract) {
      const firstError =
        contractResult.issues.find((issue) => issue.severity === "error") ??
        contractResult.issues[0];
      base.compileStatus = "invalid";
      base.compileError = {
        code: APP_ERROR_CODES.MCP_COMPILE_INVALID,
        message:
          firstError?.message ??
          `Tool "${tool.name}" agent contract is not ready.`,
        path: firstError?.path,
        nodeId: firstError?.id,
      };
      return base;
    }
    base.compileStatus = "valid";
    base.contractFingerprint = contractResult.contract.fingerprint;
    base.annotations = contractResult.contract.annotations;
    return base;
  });
}

/**
 * Server-value ids a candidate actually depends on: tool request definitions,
 * structural auth bindings, and common header/query bindings. Only these are
 * snapshotted, so an unreferenced secret slot can be published out of the
 * active revision and then deleted.
 */
function collectReferencedValueIds(
  aggregate: DraftAggregate,
  common: McpCommonEntries,
  auth: McpAuthConfiguration | null,
): Set<string> {
  const ids = new Set<string>();
  for (const tool of aggregate.tools) {
    const parsed = mcpRequestDefinitionSchema.safeParse(tool.requestDefinition);
    if (!parsed.success) continue;
    for (const ref of scanDefinitionIds(parsed.data).serverValueRefs) {
      ids.add(ref.id);
    }
  }
  for (const entry of [...common.headers, ...common.query]) {
    const binding = entry.value as { kind?: string; serverValueId?: string };
    if (binding?.kind === "serverValue" && binding.serverValueId) {
      ids.add(binding.serverValueId);
    }
  }
  if (auth) {
    for (const binding of auth.bindings) {
      ids.add(binding.serverValueId);
    }
    if (auth.basicUsernameValueId) ids.add(auth.basicUsernameValueId);
    if (auth.basicPasswordValueId) ids.add(auth.basicPasswordValueId);
  }
  return ids;
}

export function buildPublicationCandidate(
  aggregate: DraftAggregate,
): PublicationCandidate {
  const serverValueRefs: CompileServerValueRef[] = aggregate.values.map(
    (row) => ({
      id: row.id,
      name: row.name,
      kind: resolveValueKind(row),
      owner: (row.owner as "manual" | "auth" | null) ?? "manual",
    }),
  );
  const auth = parseAuthConfiguration(aggregate.server.authConfiguration);
  const common = parseCommonEntries(aggregate.server);
  const basePath = new URL(aggregate.server.baseUrl).pathname;

  const tools = buildCandidateTools(
    aggregate,
    serverValueRefs,
    common,
    auth,
    basePath,
  );
  const referencedValueIds = collectReferencedValueIds(aggregate, common, auth);
  const configs: PublicationConfig[] = aggregate.values
    .filter((row) => referencedValueIds.has(row.id))
    .map((row) => {
      const kind = resolveValueKind(row);
      return {
        sourceValueId: row.id,
        name: row.name,
        kind,
        owner: row.owner ?? null,
        description: row.description ?? null,
        value: kind === "secret" ? null : (row.value ?? null),
      };
    });

  const server = {
    name: aggregate.server.name,
    description: aggregate.server.description ?? null,
    baseUrl: aggregate.server.baseUrl,
    allowedHosts: aggregate.server.allowedHosts ?? [],
    commonEntries: common,
    authConfiguration: auth,
  };

  const enabledContracts = tools
    .filter(
      (tool) =>
        tool.enabled &&
        tool.compileStatus === "valid" &&
        tool.contractFingerprint,
    )
    .map((tool) => ({
      name: tool.name,
      fingerprint: tool.contractFingerprint as string,
    }));

  const candidate: PublicationCandidate = {
    server,
    tools,
    configs,
    candidateFingerprint: computeCandidateFingerprint(server, tools, configs),
    contractFingerprint: computeAggregateContractFingerprint(enabledContracts),
    enabledContracts,
    errors: [],
    warnings: [],
    ready: false,
  };
  candidate.errors = deriveCandidateReadiness(candidate).errors;
  candidate.ready = candidate.errors.length === 0;
  return candidate;
}

function warningsFromDiff(
  candidate: PublicationCandidate,
  diff: PublicationDiff,
): PublicationIssue[] {
  const warnings: PublicationIssue[] = [];
  if (diff.summary.contractChanged) {
    warnings.push({
      severity: "warning",
      code: "contract_changed",
      message: "The enabled agent contract changes with this publication.",
    });
  }
  if (diff.summary.toolsAdded.length > 0) {
    warnings.push({
      severity: "warning",
      code: "tool_added",
      message: "One or more tools are added to the agent contract.",
      toolName: diff.summary.toolsAdded.join(", "),
    });
  }
  if (diff.summary.toolsRemoved.length > 0) {
    warnings.push({
      severity: "warning",
      code: "tool_removed",
      message: "One or more published tools are removed.",
      toolName: diff.summary.toolsRemoved.join(", "),
    });
  }
  if (diff.summary.toolsDisabled.length > 0) {
    warnings.push({
      severity: "warning",
      code: "tool_disabled",
      message: "One or more published tools are disabled.",
      toolName: diff.summary.toolsDisabled.join(", "),
    });
  }
  if (diff.destructive) {
    warnings.push({
      severity: "warning",
      code: "destructive_change",
      message: "This publication changes mutating or destructive behavior.",
    });
  }
  if (diff.summary.authChanged) {
    warnings.push({
      severity: "warning",
      code: "auth_changed",
      message: "Structural authentication configuration changes.",
    });
  }
  if (diff.summary.configChanged) {
    warnings.push({
      severity: "warning",
      code: "config_changed",
      message: "Non-secret configuration values change.",
    });
  }
  return warnings;
}

export async function loadRevisionSummary(
  db: DB,
  serverId: string,
  revisionId: string,
): Promise<ActiveRevisionSummary | null> {
  const [revision] = await db
    .select()
    .from(mcpServerRevision)
    .where(
      and(
        eq(mcpServerRevision.id, revisionId),
        eq(mcpServerRevision.serverId, serverId),
      ),
    )
    .limit(1);
  if (!revision) return null;
  const tools = await db
    .select()
    .from(mcpServerRevisionTool)
    .where(eq(mcpServerRevisionTool.revisionId, revision.id))
    .orderBy(asc(mcpServerRevisionTool.toolOrder));
  const configs = await db
    .select()
    .from(mcpServerRevisionConfig)
    .where(eq(mcpServerRevisionConfig.revisionId, revision.id));
  return {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    candidateFingerprint: revision.candidateFingerprint,
    contractFingerprint: revision.contractFingerprint,
    server: {
      name: revision.name,
      description: revision.description ?? null,
      baseUrl: revision.baseUrl,
      allowedHosts: revision.allowedHosts ?? [],
      commonEntries: revision.commonEntries ?? null,
      authConfiguration: revision.authConfiguration ?? null,
    },
    tools: tools.map((tool) => ({
      sourceToolId: tool.sourceToolId,
      name: tool.name,
      enabled: tool.enabled,
      allowMutation: tool.allowMutation,
      method: tool.method,
      contractFingerprint: tool.contractFingerprint ?? null,
      definitionHash: tool.definitionHash ?? null,
    })),
    configs: configs.map((config) => ({
      sourceValueId: config.sourceValueId,
      name: config.name,
      kind: (config.kind as "config" | "secret") ?? "config",
      value: config.value ?? null,
    })),
  };
}

async function loadActiveRevisionSummary(
  db: DB,
  server: Pick<McpServer, "publishedRevisionId">,
  serverId: string,
): Promise<ActiveRevisionSummary | null> {
  if (!server.publishedRevisionId) return null;
  return loadRevisionSummary(db, serverId, server.publishedRevisionId);
}

export async function previewPublish(
  db: DB,
  userId: string,
  serverId: string,
): Promise<PublishPreview> {
  let stage: "load" | "candidate" | "diff" = "load";
  try {
    const aggregate = await loadDraftAggregate(db, { userId, serverId });
    stage = "candidate";
    const candidate = buildPublicationCandidate(aggregate);
    stage = "diff";
    const active = await loadActiveRevisionSummary(
      db,
      aggregate.server,
      serverId,
    );
    const diff = diffCandidateAgainstRevision(candidate, active);
    const warnings = warningsFromDiff(candidate, diff);
    const dirty = active
      ? active.candidateFingerprint !== candidate.candidateFingerprint
      : true;
    return {
      serverId,
      draftRevision: aggregate.server.draftRevision,
      publishedRevisionId: aggregate.server.publishedRevisionId ?? null,
      publishedRevisionNumber: active?.revisionNumber ?? null,
      candidateFingerprint: candidate.candidateFingerprint,
      contractFingerprint: candidate.contractFingerprint,
      ready: candidate.ready,
      dirty,
      errors: candidate.errors,
      warnings,
      warningCodes: warnings.map((warning) => warning.code),
      diff: {
        ...diff.summary,
        changed: diff.changed,
        destructive: diff.destructive,
      },
    };
  } catch (error) {
    captureMcpTelemetry(MCP_TELEMETRY_EVENTS.publishPreviewFailed, {
      db,
      userId,
      properties: {
        serverId,
        stage,
        errorCode: error instanceof AppError ? error.appCode : "internal",
      },
    });
    throw error;
  }
}

function mapPublishResult(
  revision: McpServerRevision,
  server: McpServer,
  idempotent: boolean,
): PublishResult {
  return {
    serverId: revision.serverId,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    candidateFingerprint: revision.candidateFingerprint,
    contractFingerprint: revision.contractFingerprint,
    sourceDraftRevision: revision.sourceDraftRevision,
    status: server.status,
    configRevision: server.configRevision,
    idempotent,
  };
}

export async function publishServer(
  db: DB,
  input: PublishServerInput,
): Promise<PublishResult> {
  const startedAt = Date.now();
  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = await runPublishTransaction(db, input);
      captureMcpTelemetry(MCP_TELEMETRY_EVENTS.publishSucceeded, {
        db,
        userId: input.userId,
        properties: {
          serverId: input.serverId,
          revisionNumber: result.revisionNumber,
          actorSource: input.actorSource,
          idempotent: result.idempotent,
          latencyMs: Date.now() - startedAt,
        },
      });
      return result;
    } catch (error) {
      if (
        isRetryableTransactionError(error) &&
        attempt < PUBLISH_MAX_ATTEMPTS
      ) {
        continue;
      }
      if (
        error instanceof AppError &&
        PUBLISH_CONFLICT_CODES.has(error.appCode)
      ) {
        const details = (error.details ?? {}) as Record<string, unknown>;
        captureMcpTelemetry(MCP_TELEMETRY_EVENTS.publishConflict, {
          db,
          userId: input.userId,
          properties: {
            serverId: input.serverId,
            conflictCode: error.appCode,
            actorSource: input.actorSource,
            expectedDraftRevision: input.expectedDraftRevision,
            expectedPublishedRevisionId: input.expectedPublishedRevisionId,
            ...(typeof details.draftRevision === "number"
              ? { currentDraftRevision: details.draftRevision }
              : {}),
            ...(typeof details.publishedRevisionId === "string" ||
            details.publishedRevisionId === null
              ? { currentPublishedRevisionId: details.publishedRevisionId }
              : {}),
          },
        });
      }
      throw error;
    }
  }
}

async function runPublishTransaction(
  db: DB,
  input: PublishServerInput,
): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    const [server] = await tx
      .select()
      .from(mcpServer)
      .where(
        and(
          eq(mcpServer.id, input.serverId),
          eq(mcpServer.userId, input.userId),
        ),
      )
      .for("update")
      .limit(1);
    if (!server) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
        message: "MCP server not found.",
        status: 404,
      });
    }

    const [existing] = await tx
      .select()
      .from(mcpServerRevision)
      .where(
        and(
          eq(mcpServerRevision.serverId, server.id),
          eq(mcpServerRevision.publishRequestId, input.publishRequestId),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.candidateFingerprint !== input.candidateFingerprint) {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_PUBLISH_IDEMPOTENCY_CONFLICT,
          message:
            "This publish request id was committed with different content.",
          status: 409,
          details: {
            serverId: server.id,
            publishedRevisionId: existing.id,
            publishedRevisionNumber: existing.revisionNumber,
          },
        });
      }
      return mapPublishResult(existing, server, true);
    }

    if (server.draftRevision !== input.expectedDraftRevision) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_PUBLISH_STALE_DRAFT,
        message:
          "The draft changed after preview; re-preview before publishing.",
        status: 409,
        details: {
          serverId: server.id,
          draftRevision: server.draftRevision,
          refreshRequired: true,
        },
      });
    }
    if (
      (server.publishedRevisionId ?? null) !==
      (input.expectedPublishedRevisionId ?? null)
    ) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_PUBLISH_STALE_REVISION,
        message: "The active revision changed; reload before publishing.",
        status: 409,
        details: {
          serverId: server.id,
          publishedRevisionId: server.publishedRevisionId ?? null,
          refreshRequired: true,
        },
      });
    }

    const aggregate = await loadDraftAggregate(tx, {
      userId: input.userId,
      serverId: server.id,
    });
    const candidate = buildPublicationCandidate(aggregate);
    if (candidate.candidateFingerprint !== input.candidateFingerprint) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_PUBLISH_CANDIDATE_CHANGED,
        message:
          "The draft changed after preview; re-preview before publishing.",
        status: 409,
        details: {
          serverId: server.id,
          draftRevision: server.draftRevision,
          candidateFingerprint: candidate.candidateFingerprint,
          refreshRequired: true,
        },
      });
    }
    if (!candidate.ready) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_PUBLISH_NOT_READY,
        message: "The draft has blocking publication errors.",
        status: 409,
        details: {
          serverId: server.id,
          toolNames: candidate.errors
            .map((issue) => issue.toolName)
            .filter((name): name is string => Boolean(name)),
        },
      });
    }

    // Lowering the configured cap leaves over-cap drafts behind, so the bound is
    // re-checked here: the published revision is what agents can reach.
    const maxToolsPerServer = getMcpMaxToolsPerServer();
    const enabledToolCount = candidate.tools.filter(
      (tool) => tool.enabled,
    ).length;
    if (enabledToolCount > maxToolsPerServer) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_TOOL_LIMIT_REACHED,
        message: `A server cannot have more than ${maxToolsPerServer} enabled tools.`,
        status: 400,
        details: {
          serverId: server.id,
          limit: maxToolsPerServer,
          observed: enabledToolCount,
        },
      });
    }

    const active = await loadActiveRevisionSummary(tx, server, server.id);
    if (
      active &&
      active.candidateFingerprint === candidate.candidateFingerprint
    ) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_PUBLISH_NO_CHANGES,
        message: "There are no publishable changes.",
        status: 409,
        details: {
          serverId: server.id,
          candidateFingerprint: candidate.candidateFingerprint,
          publishedRevisionId: active.id,
          publishedRevisionNumber: active.revisionNumber,
        },
      });
    }

    const diff = diffCandidateAgainstRevision(candidate, active);
    const warnings = warningsFromDiff(candidate, diff);
    const acknowledged = new Set(input.acknowledgedWarningCodes ?? []);
    const unacknowledged = warnings.filter(
      (warning) => !acknowledged.has(warning.code),
    );
    if (unacknowledged.length > 0) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_PUBLISH_WARNINGS_UNACKNOWLEDGED,
        message: "Publish warnings must be acknowledged for this candidate.",
        status: 409,
        details: {
          serverId: server.id,
          candidateFingerprint: candidate.candidateFingerprint,
          warningCodes: warnings.map((warning) => warning.code),
        },
      });
    }

    const [maxRow] = await tx
      .select({
        value: sql<number>`coalesce(max(${mcpServerRevision.revisionNumber}), 0)`,
      })
      .from(mcpServerRevision)
      .where(eq(mcpServerRevision.serverId, server.id));
    const revisionNumber = Number(maxRow?.value ?? 0) + 1;
    const revisionId = generateId("msr");

    await tx.insert(mcpServerRevision).values({
      id: revisionId,
      serverId: server.id,
      revisionNumber,
      sourceDraftRevision: server.draftRevision,
      candidateFingerprint: candidate.candidateFingerprint,
      contractFingerprint: candidate.contractFingerprint,
      schemaVersion: MCP_REVISION_SCHEMA_VERSION,
      compilerVersion: MCP_REVISION_COMPILER_VERSION,
      name: candidate.server.name,
      description: candidate.server.description,
      baseUrl: candidate.server.baseUrl,
      allowedHosts: candidate.server.allowedHosts,
      commonEntries: candidate.server
        .commonEntries as NewMcpServerRevision["commonEntries"],
      authConfiguration: candidate.server
        .authConfiguration as NewMcpServerRevision["authConfiguration"],
      diffSummary: diff.summary,
      publishRequestId: input.publishRequestId,
      actorSource: input.actorSource,
      actorUserId: input.userId,
      note: input.note ?? null,
    });

    const provenanceByToolId = new Map<string, Record<string, unknown>>();
    for (const tool of aggregate.tools) {
      const provenance = parseOpenApiSourceProvenance(tool.sourceProvenance);
      if (provenance) provenanceByToolId.set(tool.id, provenance);
    }

    if (candidate.tools.length > 0) {
      await tx.insert(mcpServerRevisionTool).values(
        candidate.tools.map((tool) => ({
          revisionId,
          serverId: server.id,
          sourceToolId: tool.sourceToolId,
          name: tool.name,
          title: tool.title,
          description: tool.description,
          method: tool.method,
          requestDefinition: tool.requestDefinition,
          compiledPlan: tool.compiledPlan,
          compileStatus: tool.compileStatus,
          compileIssues: tool.compileIssues as unknown as Array<
            Record<string, unknown>
          >,
          annotations: tool.annotations as unknown as Record<string, unknown>,
          allowMutation: tool.allowMutation,
          enabled: tool.enabled,
          source: tool.source,
          sourceProvenance: provenanceByToolId.get(tool.sourceToolId) ?? null,
          contractFingerprint: tool.contractFingerprint,
          definitionHash: tool.definitionHash,
          toolOrder: tool.toolOrder,
        })),
      );
    }

    if (candidate.configs.length > 0) {
      await tx.insert(mcpServerRevisionConfig).values(
        candidate.configs.map((config) => ({
          revisionId,
          serverId: server.id,
          sourceValueId: config.sourceValueId,
          name: config.name,
          kind: config.kind,
          owner: config.owner,
          description: config.description,
          value: config.value,
        })),
      );
    }

    const nextStatus = server.status === "draft" ? "live" : server.status;
    const [updated] = await tx
      .update(mcpServer)
      .set({
        publishedRevisionId: revisionId,
        status: nextStatus,
        configRevision: server.configRevision + 1,
        updatedAt: new Date(),
      })
      .where(eq(mcpServer.id, server.id))
      .returning();
    const effective = updated ?? {
      ...server,
      publishedRevisionId: revisionId,
      status: nextStatus,
      configRevision: server.configRevision + 1,
    };

    const [revision] = await tx
      .select()
      .from(mcpServerRevision)
      .where(eq(mcpServerRevision.id, revisionId))
      .limit(1);
    if (!revision) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_REVISION_NOT_FOUND,
        message: "Published revision could not be read back.",
        status: 500,
      });
    }
    return mapPublishResult(revision, effective, false);
  });
}

/**
 * Runtime identity of one tool in the active published revision. Platform
 * invocation preflight must classify method/name from the immutable revision,
 * never from the mutable draft, because draft edits do not affect live
 * behavior until publication.
 */
export async function getPublishedToolIdentity(
  db: DB,
  userId: string,
  serverId: string,
  toolId: string,
  credentialSecret: string,
): Promise<{
  name: string;
  method: string;
  snapshot: McpExecutionSnapshot;
}> {
  const [server] = await db
    .select()
    .from(mcpServer)
    .where(and(eq(mcpServer.id, serverId), eq(mcpServer.userId, userId)))
    .limit(1);
  if (!server) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
      message: "MCP server not found.",
      status: 404,
    });
  }
  // One snapshot drives both authorization classification and execution so a
  // concurrent publication cannot change the executed method after the gate.
  const snapshot = await loadExecutionSnapshot(db, {
    serverId,
    credentialSecret,
  });
  if (!snapshot || snapshot.publishedRevisionId === null) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
      message: "MCP tool not found.",
      status: 404,
      details: { serverId, refreshRequired: true },
    });
  }
  const entry = snapshot.tools.find((tool) => tool.tool.id === toolId);
  if (!entry) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
      message: "MCP tool not found.",
      status: 404,
      details: {
        serverId,
        publishedRevisionId: snapshot.publishedRevisionId,
        refreshRequired: true,
      },
    });
  }
  return {
    name: entry.tool.name,
    method: entry.tool.method,
    snapshot,
  };
}

export async function listRevisionHistory(
  db: DB,
  userId: string,
  serverId: string,
  input: PaginationInput,
): Promise<{
  items: RevisionSummary[];
  page: number;
  pageSize: number;
  total: number;
}> {
  const [server] = await db
    .select()
    .from(mcpServer)
    .where(and(eq(mcpServer.id, serverId), eq(mcpServer.userId, userId)))
    .limit(1);
  if (!server) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
      message: "MCP server not found.",
      status: 404,
    });
  }
  const page = await paginate({
    page: input.page,
    pageSize: input.pageSize,
    list: (offset, limit) =>
      db
        .select()
        .from(mcpServerRevision)
        .where(eq(mcpServerRevision.serverId, serverId))
        .orderBy(desc(mcpServerRevision.revisionNumber))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ value: count() })
        .from(mcpServerRevision)
        .where(eq(mcpServerRevision.serverId, serverId));
      return row?.value ?? 0;
    },
  });
  return {
    ...page,
    items: page.items.map((revision) =>
      toRevisionSummary(revision, server.publishedRevisionId),
    ),
  };
}

function toRevisionSummary(
  revision: McpServerRevision,
  activeRevisionId: string | null,
): RevisionSummary {
  return {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    sourceDraftRevision: revision.sourceDraftRevision,
    candidateFingerprint: revision.candidateFingerprint,
    contractFingerprint: revision.contractFingerprint,
    actorSource: revision.actorSource,
    note: revision.note ?? null,
    isActive: activeRevisionId === revision.id,
    createdAt: revision.createdAt,
  };
}

export async function getRevisionDetail(
  db: DB,
  userId: string,
  serverId: string,
  revisionId: string,
): Promise<RevisionDetail> {
  const aggregate = await loadDraftAggregate(db, { userId, serverId });
  const [revision] = await db
    .select()
    .from(mcpServerRevision)
    .where(
      and(
        eq(mcpServerRevision.id, revisionId),
        eq(mcpServerRevision.serverId, serverId),
      ),
    )
    .limit(1);
  if (!revision) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_REVISION_NOT_FOUND,
      message: "Published revision not found.",
      status: 404,
    });
  }
  const tools = await db
    .select()
    .from(mcpServerRevisionTool)
    .where(eq(mcpServerRevisionTool.revisionId, revisionId))
    .orderBy(asc(mcpServerRevisionTool.toolOrder));
  const configs = await db
    .select()
    .from(mcpServerRevisionConfig)
    .where(eq(mcpServerRevisionConfig.revisionId, revisionId));
  const existingSecretIds = new Set(
    aggregate.values
      .filter((value) => resolveValueKind(value) === "secret")
      .map((value) => value.id),
  );
  const mappedConfigs = configs.map((config) => ({
    sourceValueId: config.sourceValueId,
    name: config.name,
    kind: config.kind,
    owner: config.owner ?? null,
    hasValue: config.value !== null && config.value !== undefined,
    available:
      config.kind !== "secret" || existingSecretIds.has(config.sourceValueId),
  }));

  return {
    ...toRevisionSummary(revision, aggregate.server.publishedRevisionId),
    schemaVersion: revision.schemaVersion,
    compilerVersion: revision.compilerVersion,
    server: {
      name: revision.name,
      description: revision.description ?? null,
      baseUrl: revision.baseUrl,
      allowedHosts: revision.allowedHosts ?? [],
    },
    diffSummary: revision.diffSummary ?? null,
    tools: tools.map((tool) => ({
      sourceToolId: tool.sourceToolId,
      name: tool.name,
      title: tool.title ?? null,
      description: tool.description ?? null,
      method: tool.method,
      enabled: tool.enabled,
      allowMutation: tool.allowMutation,
      source: tool.source,
      contractFingerprint: tool.contractFingerprint ?? null,
      definitionHash: tool.definitionHash ?? null,
      compileStatus: tool.compileStatus ?? null,
      compileIssueCount: Array.isArray(tool.compileIssues)
        ? tool.compileIssues.length
        : 0,
    })),
    configs: mappedConfigs,
    missingSecretCount: mappedConfigs.filter(
      (config) => config.kind === "secret" && !config.available,
    ).length,
  };
}

export async function restoreRevisionToDraft(
  db: DB,
  input: RestoreRevisionInput,
): Promise<RestoreRevisionResult> {
  return db.transaction(async (tx) => {
    const [server] = await tx
      .select()
      .from(mcpServer)
      .where(
        and(
          eq(mcpServer.id, input.serverId),
          eq(mcpServer.userId, input.userId),
        ),
      )
      .for("update")
      .limit(1);
    if (!server) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
        message: "MCP server not found.",
        status: 404,
      });
    }
    if (server.configRevision !== input.expectedRevision) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
        message: "The server changed; reload before restoring.",
        status: 409,
        details: {
          serverId: server.id,
          currentRevision: server.configRevision,
          refreshRequired: true,
        },
      });
    }
    if (server.draftRevision !== input.expectedDraftRevision) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_PUBLISH_STALE_DRAFT,
        message: "The draft changed; reload history before restoring.",
        status: 409,
        details: {
          serverId: server.id,
          draftRevision: server.draftRevision,
          refreshRequired: true,
        },
      });
    }

    const [revision] = await tx
      .select()
      .from(mcpServerRevision)
      .where(
        and(
          eq(mcpServerRevision.id, input.revisionId),
          eq(mcpServerRevision.serverId, server.id),
        ),
      )
      .limit(1);
    if (!revision) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_REVISION_NOT_FOUND,
        message: "Published revision not found.",
        status: 404,
      });
    }
    const revisionTools = await tx
      .select()
      .from(mcpServerRevisionTool)
      .where(eq(mcpServerRevisionTool.revisionId, revision.id))
      .orderBy(asc(mcpServerRevisionTool.toolOrder));
    const revisionConfigs = await tx
      .select()
      .from(mcpServerRevisionConfig)
      .where(eq(mcpServerRevisionConfig.revisionId, revision.id));

    const currentValues = await tx
      .select()
      .from(mcpServerVariable)
      .where(eq(mcpServerVariable.serverId, server.id));
    const existingSecretIds = new Set(
      currentValues
        .filter((row) => resolveValueKind(row) === "secret")
        .map((row) => row.id),
    );

    // Studio grouping is presentation state that survives a runtime rollback:
    // capture current assignments before the draft tool rows are rebuilt.
    const currentTools = await tx
      .select({ id: mcpTool.id, groupId: mcpTool.groupId })
      .from(mcpTool)
      .where(eq(mcpTool.serverId, server.id));
    const currentGroupIdByToolId = new Map<string, string>();
    for (const tool of currentTools) {
      if (tool.groupId) currentGroupIdByToolId.set(tool.id, tool.groupId);
    }

    await tx.delete(mcpTool).where(eq(mcpTool.serverId, server.id));
    if (revisionTools.length > 0) {
      await tx.insert(mcpTool).values(
        revisionTools.map((tool) => ({
          id: tool.sourceToolId,
          serverId: server.id,
          name: tool.name,
          title: tool.title,
          description: tool.description,
          method: tool.method,
          requestDefinition: tool.requestDefinition,
          compiledPlan: tool.compiledPlan,
          compileStatus: tool.compileStatus,
          compileIssues: tool.compileIssues as unknown as never,
          annotations: tool.annotations as unknown as never,
          allowMutation: tool.allowMutation,
          enabled: tool.enabled,
          source: tool.source,
          sourceProvenance: parseOpenApiSourceProvenance(tool.sourceProvenance),
        })),
      );
    }

    // Reapply a group only when the restored tool id kept its current valid
    // assignment. Group rows are never written by a revision operation.
    const restoredGroupIds = [
      ...new Set(
        revisionTools
          .map((tool) => currentGroupIdByToolId.get(tool.sourceToolId))
          .filter((groupId): groupId is string => Boolean(groupId)),
      ),
    ];
    if (restoredGroupIds.length > 0) {
      const survivingGroups = await tx
        .select({ id: mcpToolGroup.id })
        .from(mcpToolGroup)
        .where(
          and(
            eq(mcpToolGroup.serverId, server.id),
            inArray(mcpToolGroup.id, restoredGroupIds),
          ),
        );
      const survivingGroupIds = new Set(
        survivingGroups.map((group) => group.id),
      );
      for (const tool of revisionTools) {
        const groupId = currentGroupIdByToolId.get(tool.sourceToolId);
        if (!groupId || !survivingGroupIds.has(groupId)) continue;
        await tx
          .update(mcpTool)
          .set({ groupId })
          .where(
            and(
              eq(mcpTool.serverId, server.id),
              eq(mcpTool.id, tool.sourceToolId),
            ),
          );
      }
    }

    const revisionConfigById = new Map(
      revisionConfigs.map((config) => [config.sourceValueId, config]),
    );
    const existingConfigIds = new Set(currentValues.map((row) => row.id));
    const missingSecretIds = revisionConfigs
      .filter(
        (config) =>
          config.kind === "secret" &&
          !existingSecretIds.has(config.sourceValueId),
      )
      .map((config) => config.sourceValueId);

    for (const config of revisionConfigs) {
      if (config.kind === "secret") continue;
      const existing = currentValues.find(
        (row) => row.id === config.sourceValueId,
      );
      // Never downgrade an operational secret slot into a plaintext config.
      // That would silently change the active revision's secret classification.
      if (existing && resolveValueKind(existing) === "secret") {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_REVISION_NOT_RESTORABLE,
          message:
            "A historical config slot is currently an operational secret and cannot be restored as plaintext.",
          status: 409,
          details: {
            serverId: server.id,
            references: [{ kind: "revision", id: revision.id }],
          },
        });
      }
      if (existing) {
        await tx
          .update(mcpServerVariable)
          .set({
            name: config.name,
            kind: "config",
            owner: config.owner ?? "manual",
            description: config.description,
            value: config.value,
            ciphertext: null,
            updatedAt: new Date(),
          })
          .where(eq(mcpServerVariable.id, config.sourceValueId));
      } else {
        await tx.insert(mcpServerVariable).values({
          id: config.sourceValueId,
          serverId: server.id,
          name: config.name,
          kind: "config",
          owner: config.owner ?? "manual",
          description: config.description,
          value: config.value,
          ciphertext: null,
        });
      }
      existingConfigIds.add(config.sourceValueId);
    }

    const removableConfigIds = currentValues
      .filter(
        (row) =>
          resolveValueKind(row) === "config" && !revisionConfigById.has(row.id),
      )
      .map((row) => row.id);
    if (removableConfigIds.length > 0) {
      await tx
        .delete(mcpServerVariable)
        .where(
          and(
            eq(mcpServerVariable.serverId, server.id),
            inArray(mcpServerVariable.id, removableConfigIds),
          ),
        );
    }

    const nextDraftRevision = server.draftRevision + 1;
    await tx
      .update(mcpServer)
      .set({
        name: revision.name,
        description: revision.description,
        baseUrl: revision.baseUrl,
        allowedHosts: revision.allowedHosts,
        commonEntries: revision.commonEntries,
        authConfiguration: revision.authConfiguration,
        draftRevision: nextDraftRevision,
        configRevision: server.configRevision + 1,
        updatedAt: new Date(),
      })
      .where(eq(mcpServer.id, server.id));

    return {
      serverId: server.id,
      revisionId: revision.id,
      draftRevision: nextDraftRevision,
      configRevision: server.configRevision + 1,
      missingSecretCount: missingSecretIds.length,
      toolCount: revisionTools.length,
    };
  });
}

export type CleanupRevisionsResult = {
  deletedRevisions: number;
  retainedRevisions: number;
};

/**
 * Bounded retention. Always keeps the active revision and the newest
 * `minimumRetained` revisions; only superseded revisions older than the
 * retention window are deleted. Children cascade; denormalized call-log
 * attribution is untouched.
 */
export async function cleanupSupersededRevisions(
  db: DB,
  options: {
    now?: Date;
    retentionDays?: number;
    minimumRetained?: number;
    limitPerServer?: number;
    dryRun?: boolean;
  } = {},
): Promise<CleanupRevisionsResult> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? RETENTION_MAX_AGE_DAYS;
  const minimumRetained = options.minimumRetained ?? RETENTION_MINIMUM_RETAINED;
  const dryRun = options.dryRun ?? false;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  try {
    const servers = await db
      .select({
        id: mcpServer.id,
        publishedRevisionId: mcpServer.publishedRevisionId,
      })
      .from(mcpServer);

    let deletedRevisions = 0;
    let retainedRevisions = 0;
    for (const server of servers) {
      const revisions = await db
        .select({
          id: mcpServerRevision.id,
          revisionNumber: mcpServerRevision.revisionNumber,
          createdAt: mcpServerRevision.createdAt,
        })
        .from(mcpServerRevision)
        .where(eq(mcpServerRevision.serverId, server.id))
        .orderBy(desc(mcpServerRevision.revisionNumber));
      retainedRevisions += revisions.length;
      const protectedIds = new Set(
        revisions.slice(0, minimumRetained).map((revision) => revision.id),
      );
      if (server.publishedRevisionId) {
        protectedIds.add(server.publishedRevisionId);
      }
      const deletable = revisions.filter(
        (revision) =>
          !protectedIds.has(revision.id) && revision.createdAt < cutoff,
      );
      for (const revision of deletable) {
        if (!dryRun) {
          await db
            .delete(mcpServerRevision)
            .where(eq(mcpServerRevision.id, revision.id));
        }
        deletedRevisions += 1;
        retainedRevisions -= 1;
      }
    }

    captureMcpTelemetry(MCP_TELEMETRY_EVENTS.revisionRetentionCleanup, {
      db,
      properties: {
        outcome: "success",
        dryRun,
        serversScanned: servers.length,
        deletedRevisions,
        retainedRevisions,
        retentionDays,
        minimumRetained,
        latencyMs: Date.now() - startedAt,
      },
    });
    return { deletedRevisions, retainedRevisions };
  } catch (error) {
    captureMcpTelemetry(MCP_TELEMETRY_EVENTS.revisionRetentionCleanup, {
      db,
      properties: {
        outcome: "failed",
        dryRun,
        retentionDays,
        minimumRetained,
        errorCode: error instanceof AppError ? error.appCode : "internal",
        latencyMs: Date.now() - startedAt,
      },
    });
    throw error;
  }
}
