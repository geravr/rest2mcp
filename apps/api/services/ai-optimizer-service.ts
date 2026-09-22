/**
 * @file Owner-scoped AI tool-optimization service: preflight plans,
 * authorization, status/progress projections, cancellation, and rejection.
 * Preflight never calls the model; authorization rechecks every fingerprint
 * before queueing; no raw source, prompt, or credential is ever persisted.
 */
import { APP_ERROR_CODES, type AiProviderKind } from "@repo/core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, eq, inArray } from "drizzle-orm";
import {
  aiToolOptimizationItem,
  aiToolOptimizationRun,
  mcpServer,
  mcpServerVariable,
  mcpTool,
  type McpServer,
  type McpTool,
} from "@repo/db";
import { appError } from "../lib/app-error.js";
import {
  AI_TOOL_OPTIMIZATION_LIMITS,
  AI_TOOL_OPTIMIZATION_POLICY_VERSION,
  AI_TOOL_OPTIMIZATION_PROMPT_VERSION,
  OPTIMIZER_CAPABILITY_PROFILE,
  OPTIMIZER_DISCLOSED_DATA,
  OPTIMIZER_IMMUTABLE_FIELDS,
  OPTIMIZER_MUTABLE_FIELDS,
  AI_TOOL_OPTIMIZATION_POLICY_VERSION as POLICY_VERSION,
  optimizerApplyDraftResultSchema,
  optimizerItemReviewSchema,
  optimizerOperationClass,
  optimizerScopeSchema,
  type OptimizerApplyDraftInput,
  type OptimizerApplyDraftResult,
  type OptimizerAuthorizeInput,
  type OptimizerOperation,
  type OptimizerAuthorizeResult,
  type OptimizerCancelResult,
  type OptimizerEligibleItem,
  type OptimizerEstimate,
  type OptimizerIneligibleItem,
  type OptimizerItemReview,
  type OptimizerItemSummary,
  type OptimizerListItemsInput,
  type OptimizerPaginatedItems,
  type OptimizerPreflightDraftInput,
  type OptimizerPreflightOpenapiInput,
  type OptimizerPreflightResult,
  type OptimizerRejectResult,
  type OptimizerRunSummary,
  type OptimizerScope,
  type OptimizerToolSnapshotV1,
} from "../lib/mcp-optimizer-contracts.js";
import {
  sanitizeDraftTool,
  sanitizeOpenApiCandidate,
} from "../lib/mcp-optimizer-sanitize.js";
import { applySelectedOperations } from "../lib/mcp-optimizer-policy.js";
import { compileToolDefinition } from "../lib/mcp-compiler.js";
import {
  mcpAuthConfigurationSchema,
  mcpCommonEntriesSchema,
  mcpRequestDefinitionSchema,
  type McpAuthConfiguration,
  type McpCommonEntries,
} from "../lib/mcp-request-definition.js";
import { withOwnedServerWrite } from "./mcp-server-command.js";
import {
  commitOptimizerApplyMarker,
  findOptimizerApplyCommitted,
  markOptimizerItemsApplied,
} from "./ai-optimizer-repository.js";
import {
  captureMcpTelemetry,
  MCP_TELEMETRY_EVENTS,
} from "../lib/mcp-telemetry.js";
import type { McpOpenApiOperationCandidate } from "../lib/openapi-import-contracts.js";
import { resolveVerifiedSelection } from "../lib/ai/ai-runtime.js";
import type { AiProviderAdapter } from "../lib/ai/provider-adapter.js";
import {
  findOptimizerItemByRef,
  getOptimizerItemForOwner,
  getOptimizerProgress,
  getOptimizerRunForOwner,
  insertOptimizerItems,
  insertOptimizerRun,
  listOptimizerItemsPage,
  rejectOptimizerItem,
  requestOptimizerCancel,
  authorizeOptimizerRun,
  type AiToolOptimizationRun,
} from "./ai-optimizer-repository.js";
import { previewOpenApiImport } from "./mcp-openapi-import-service.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export type AiOptimizerDeps = {
  db: DB;
  /** Registry lookup; unknown provider kinds fail closed at first use. */
  getAdapter: (providerKind: AiProviderKind) => AiProviderAdapter | undefined;
};

function totalAdapter(
  deps: AiOptimizerDeps,
): (providerKind: AiProviderKind) => AiProviderAdapter {
  const adapter = (kind: AiProviderKind) => deps.getAdapter(kind);
  return (kind) => {
    const resolved = adapter(kind);
    if (!resolved) {
      throw appError({
        appCode: APP_ERROR_CODES.AI_PROVIDER_UNSUPPORTED,
        message: "The provider kind is not in the supported registry.",
        status: 400,
      });
    }
    return resolved;
  };
}

async function requireOwnedServer(
  db: DB,
  userId: string,
  serverId: string,
): Promise<McpServer> {
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
  return server;
}

function requireRunForOwner(
  run: AiToolOptimizationRun | null,
): AiToolOptimizationRun {
  if (!run) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_OPTIMIZATION_RUN_NOT_FOUND,
      message: "Optimization run not found.",
      status: 404,
    });
  }
  return run;
}

/** Resolves the current verified selection for the optimizer profile. */
function resolveOptimizerSelection(deps: AiOptimizerDeps, userId: string) {
  return resolveVerifiedSelection({
    db: deps.db,
    getAdapter: totalAdapter(deps),
    userId,
    capabilityProfile: OPTIMIZER_CAPABILITY_PROFILE,
  });
}

/** Deterministic token estimate: ~4 chars per token plus batch overhead. */
function estimateRun(snapshots: OptimizerToolSnapshotV1[]): OptimizerEstimate {
  const batchCount = Math.max(
    1,
    Math.ceil(snapshots.length / AI_TOOL_OPTIMIZATION_LIMITS.maxBatchItems),
  );
  const batchOverheadTokens = 512;
  const inputTokens =
    snapshots.reduce(
      (total, snapshot) =>
        total + Math.ceil(JSON.stringify(snapshot).length / 4),
      0,
    ) +
    batchCount * batchOverheadTokens;
  const outputTokens =
    batchCount * AI_TOOL_OPTIMIZATION_LIMITS.maxGenerationOutputTokens;
  // Provider pricing metadata is not available in this build; the estimate is
  // honest about that instead of claiming zero cost.
  return {
    tokens: { inputTokens, outputTokens },
    pricing: { state: "unknown" },
  };
}

type PreparedItems = {
  eligible: OptimizerEligibleItem[];
  ineligible: OptimizerIneligibleItem[];
  snapshots: OptimizerToolSnapshotV1[];
};

function buildDraftItems(tools: McpTool[]): PreparedItems {
  const eligible: OptimizerEligibleItem[] = [];
  const ineligible: OptimizerIneligibleItem[] = [];
  const snapshots: OptimizerToolSnapshotV1[] = [];
  for (const tool of tools) {
    const result = sanitizeDraftTool({
      kind: "draft",
      toolId: tool.id,
      name: tool.name,
      title: tool.title,
      description: tool.description,
      method: tool.method,
      requestDefinition: tool.requestDefinition,
      compileIssues: tool.compileIssues ?? null,
    });
    if (!result.ok) {
      ineligible.push({
        ref: { kind: "draft_tool", toolId: tool.id },
        name: tool.name,
        reason: result.reason,
      });
      continue;
    }
    eligible.push({
      ref: { kind: "draft_tool", toolId: tool.id },
      fingerprint: result.fingerprint,
      name: tool.name,
    });
    snapshots.push(result.snapshot);
  }
  return { eligible, ineligible, snapshots };
}

function buildCandidateItems(
  candidates: McpOpenApiOperationCandidate[],
  operationKeys: string[],
): PreparedItems {
  const byKey = new Map(candidates.map((c) => [c.operationKey, c]));
  const eligible: OptimizerEligibleItem[] = [];
  const ineligible: OptimizerIneligibleItem[] = [];
  const snapshots: OptimizerToolSnapshotV1[] = [];
  for (const key of operationKeys) {
    const candidate = byKey.get(key);
    if (!candidate) {
      throw appError({
        appCode: APP_ERROR_CODES.INVALID_INPUT,
        message: "The selection contains an unknown OpenAPI operation key.",
        status: 400,
      });
    }
    if (!candidate.selectable || !candidate.requestDefinition) {
      // Blocked operations stay ineligible; AI cannot unblock them.
      ineligible.push({
        ref: { kind: "openapi_candidate", operationKey: key },
        name: candidate.suggestedName,
        reason: "openapi_blocked",
      });
      continue;
    }
    const result = sanitizeOpenApiCandidate({
      kind: "openapi",
      operationKey: candidate.operationKey,
      name: candidate.suggestedName,
      ...(candidate.title ? { title: candidate.title } : {}),
      ...(candidate.description ? { description: candidate.description } : {}),
      method: candidate.method,
      requestDefinition: candidate.requestDefinition,
      compileIssues: candidate.compileIssues,
    });
    if (!result.ok) {
      ineligible.push({
        ref: { kind: "openapi_candidate", operationKey: key },
        name: candidate.suggestedName,
        reason: result.reason,
      });
      continue;
    }
    eligible.push({
      ref: { kind: "openapi_candidate", operationKey: key },
      fingerprint: result.fingerprint,
      name: candidate.suggestedName,
    });
    snapshots.push(result.snapshot);
  }
  return { eligible, ineligible, snapshots };
}

async function createPlannedRun(input: {
  deps: AiOptimizerDeps;
  userId: string;
  serverId: string;
  source: "draft" | "openapi";
  scope: OptimizerScope;
  scopeKind: OptimizerScope["kind"];
  documentFingerprint: string | null;
  model: {
    providerKind: string;
    modelId: string;
    readinessFingerprint: string;
  };
  prepared: PreparedItems;
  configRevision: number;
  draftRevision: number;
}): Promise<OptimizerPreflightResult> {
  const { deps, userId, prepared } = input;
  const now = new Date();
  const plannedExpiresAt = new Date(
    now.getTime() + AI_TOOL_OPTIMIZATION_LIMITS.planTtlMs,
  );
  const estimate = estimateRun(prepared.snapshots);

  const run = await deps.db.transaction(async (tx) => {
    const run = await insertOptimizerRun(tx, {
      userId,
      serverId: input.serverId,
      source: input.source,
      scopeKind: input.scopeKind,
      scope: input.scope as unknown as Record<string, unknown>,
      state: "planned",
      policyVersion: AI_TOOL_OPTIMIZATION_POLICY_VERSION,
      promptVersion: AI_TOOL_OPTIMIZATION_PROMPT_VERSION,
      providerKind: input.model.providerKind,
      modelId: input.model.modelId,
      readinessFingerprint: input.model.readinessFingerprint,
      serverConfigRevision: input.configRevision,
      serverDraftRevision: input.draftRevision,
      ...(input.documentFingerprint
        ? { documentFingerprint: input.documentFingerprint }
        : {}),
      eligibleCount: prepared.eligible.length,
      ineligibleCount: prepared.ineligible.length,
      estimate: estimate as unknown as Record<string, unknown>,
      plannedExpiresAt,
    });
    await insertOptimizerItems(
      tx,
      prepared.eligible.map((item, index) => {
        const snapshot = prepared.snapshots[index]!;
        return {
          runId: run.id,
          refKind: item.ref.kind,
          toolId: item.ref.kind === "draft_tool" ? item.ref.toolId : null,
          operationKey:
            item.ref.kind === "openapi_candidate"
              ? item.ref.operationKey
              : null,
          name: item.name,
          fingerprint: item.fingerprint,
          state: "queued",
          snapshot: snapshot as unknown as Record<string, unknown>,
          ordinal: index,
        };
      }),
    );
    return run;
  });

  return {
    runId: run.id,
    state: "planned",
    serverId: input.serverId,
    source: input.source,
    scope: input.scope,
    scopeKind: input.scopeKind,
    model: input.model,
    policyVersion: AI_TOOL_OPTIMIZATION_POLICY_VERSION,
    promptVersion: AI_TOOL_OPTIMIZATION_PROMPT_VERSION,
    eligible: prepared.eligible,
    ineligible: prepared.ineligible,
    disclosedData: OPTIMIZER_DISCLOSED_DATA,
    mutableFields: OPTIMIZER_MUTABLE_FIELDS,
    immutableFields: OPTIMIZER_IMMUTABLE_FIELDS,
    estimate,
    expiresAt: plannedExpiresAt,
  };
}

/** Write-free preflight for one tool, selected tools, or all eligible tools. */
export async function preflightDraftOptimization(
  deps: AiOptimizerDeps,
  userId: string,
  input: OptimizerPreflightDraftInput,
): Promise<OptimizerPreflightResult> {
  const server = await requireOwnedServer(deps.db, userId, input.serverId);
  if (server.configRevision !== input.expectedConfigRevision) {
    throw stalePlanError("server_revision");
  }
  const selection = await resolveOptimizerSelection(deps, userId);

  const tools = await deps.db
    .select()
    .from(mcpTool)
    .where(eq(mcpTool.serverId, server.id));

  const scope = optimizerScopeSchema.parse(input.scope);
  let scoped: McpTool[];
  if (scope.kind === "all_eligible") {
    // The full owned server set, never the current page or search filter.
    scoped = tools;
  } else if (scope.kind === "single" || scope.kind === "selected") {
    const byId = new Map(tools.map((tool) => [tool.id, tool]));
    scoped = scope.toolIds.map((toolId) => {
      const tool = byId.get(toolId);
      if (!tool) {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
          message: "A selected tool does not exist on this server.",
          status: 404,
        });
      }
      return tool;
    });
  } else {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "OpenAPI scopes belong on the OpenAPI preflight endpoint.",
      status: 400,
    });
  }

  const prepared = buildDraftItems(scoped);
  if (prepared.eligible.length === 0) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_OPTIMIZATION_INELIGIBLE,
      message: "No selected tool can be analyzed safely.",
      status: 422,
    });
  }

  return createPlannedRun({
    deps,
    userId,
    serverId: server.id,
    source: "draft",
    scope,
    scopeKind: scope.kind,
    documentFingerprint: null,
    model: {
      providerKind: selection.providerKind,
      modelId: selection.modelId,
      readinessFingerprint: selection.storedFingerprint,
    },
    prepared,
    configRevision: server.configRevision,
    draftRevision: server.draftRevision,
  });
}

/** Write-free preflight for selected OpenAPI candidates; stores no document. */
export async function preflightOpenApiOptimization(
  deps: AiOptimizerDeps,
  userId: string,
  input: OptimizerPreflightOpenapiInput,
): Promise<OptimizerPreflightResult> {
  const server = await requireOwnedServer(deps.db, userId, input.serverId);
  if (server.configRevision !== input.expectedConfigRevision) {
    throw stalePlanError("server_revision");
  }
  const selection = await resolveOptimizerSelection(deps, userId);

  const preview = await previewOpenApiImport(deps.db, userId, server.id, {
    source: input.source,
  });
  if (preview.document.fingerprint !== input.fingerprint) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_OPTIMIZATION_SOURCE_STALE,
      message:
        "The OpenAPI source no longer matches the previewed fingerprint.",
      status: 409,
    });
  }

  const prepared = buildCandidateItems(preview.operations, input.operationKeys);
  if (prepared.eligible.length === 0) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_OPTIMIZATION_INELIGIBLE,
      message: "No selected candidate can be analyzed safely.",
      status: 422,
    });
  }

  return createPlannedRun({
    deps,
    userId,
    serverId: server.id,
    source: "openapi",
    scope: { kind: "openapi", operationKeys: input.operationKeys },
    scopeKind: "openapi",
    documentFingerprint: preview.document.fingerprint,
    model: {
      providerKind: selection.providerKind,
      modelId: selection.modelId,
      readinessFingerprint: selection.storedFingerprint,
    },
    prepared,
    configRevision: server.configRevision,
    draftRevision: server.draftRevision,
  });
}

/**
 * Authorizes the exact planned run: state, expiry, server revisions, source
 * fingerprint, per-item tool fingerprints, and the model fingerprint must all
 * still match before the run is queued. No model call happens here.
 */
export async function authorizeOptimization(
  deps: AiOptimizerDeps,
  userId: string,
  input: OptimizerAuthorizeInput,
): Promise<OptimizerAuthorizeResult> {
  const run = requireRunForOwner(
    await getOptimizerRunForOwner(deps.db, { userId, runId: input.runId }),
  );
  if (run.state !== "planned") {
    throw appError({
      appCode: APP_ERROR_CODES.AI_OPTIMIZATION_STATE_INVALID,
      message: "Only a planned run can be authorized.",
      status: 409,
    });
  }
  if (run.plannedExpiresAt.getTime() <= Date.now()) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_OPTIMIZATION_PLAN_EXPIRED,
      message: "The optimization plan expired.",
      status: 410,
    });
  }

  const server = await requireOwnedServer(deps.db, userId, run.serverId);
  if (
    server.configRevision !== input.expectedConfigRevision ||
    server.configRevision !== run.serverConfigRevision
  ) {
    throw stalePlanError("server_revision");
  }
  if (
    input.expectedDraftRevision !== undefined &&
    server.draftRevision !== input.expectedDraftRevision
  ) {
    throw stalePlanError("draft_revision");
  }

  // The model selection bound to the plan must still be the current one.
  const selection = await resolveOptimizerSelection(deps, userId);
  if (
    selection.storedFingerprint !== run.readinessFingerprint ||
    selection.modelId !== run.modelId
  ) {
    throw stalePlanError("model_drift");
  }

  // Recheck every scoped item fingerprint against the current draft/source.
  const scope = optimizerScopeSchema.parse(run.scope);
  if (run.source === "draft") {
    const tools = await deps.db
      .select()
      .from(mcpTool)
      .where(eq(mcpTool.serverId, run.serverId));
    const byId = new Map(tools.map((tool) => [tool.id, tool]));
    const toolIds =
      scope.kind === "single" || scope.kind === "selected"
        ? [...scope.toolIds]
        : tools.map((tool) => tool.id);
    for (const toolId of toolIds) {
      const tool = byId.get(toolId);
      if (!tool) throw stalePlanError("tool_removed");
      const result = sanitizeDraftTool({
        kind: "draft",
        toolId: tool.id,
        name: tool.name,
        title: tool.title,
        description: tool.description,
        method: tool.method,
        requestDefinition: tool.requestDefinition,
        compileIssues: tool.compileIssues ?? null,
      });
      const storedItem = await findOptimizerItemByRef(deps.db, {
        runId: run.id,
        toolId,
      });
      if (result.ok) {
        if (!storedItem || storedItem.fingerprint !== result.fingerprint) {
          throw stalePlanError("tool_drift");
        }
      } else if (storedItem) {
        // A previously eligible tool can no longer be snapshotted.
        throw stalePlanError("tool_drift");
      }
    }
  } else {
    if (scope.kind !== "openapi") {
      throw appError({
        appCode: APP_ERROR_CODES.INVALID_INPUT,
        message: "Draft scopes belong on the draft authorization endpoint.",
        status: 400,
      });
    }
    if (!input.source) {
      throw appError({
        appCode: APP_ERROR_CODES.INVALID_INPUT,
        message: "OpenAPI authorization requires the source for rechecking.",
        status: 400,
      });
    }
    const preview = await previewOpenApiImport(deps.db, userId, run.serverId, {
      source: input.source,
    });
    if (preview.document.fingerprint !== run.documentFingerprint) {
      throw stalePlanError("source_drift");
    }
    for (const key of scope.operationKeys) {
      const candidate = preview.operations.find((c) => c.operationKey === key);
      if (!candidate) throw stalePlanError("candidate_removed");
      if (!candidate.selectable || !candidate.requestDefinition) continue;
      const result = sanitizeOpenApiCandidate({
        kind: "openapi",
        operationKey: candidate.operationKey,
        name: candidate.suggestedName,
        ...(candidate.title ? { title: candidate.title } : {}),
        ...(candidate.description
          ? { description: candidate.description }
          : {}),
        method: candidate.method,
        requestDefinition: candidate.requestDefinition,
        compileIssues: candidate.compileIssues,
      });
      if (!result.ok) throw stalePlanError("candidate_drift");
      const storedItem = await findOptimizerItemByRef(deps.db, {
        runId: run.id,
        operationKey: key,
      });
      if (!storedItem || storedItem.fingerprint !== result.fingerprint) {
        throw stalePlanError("candidate_drift");
      }
    }
  }

  const authorized = await deps.db.transaction(async (tx) =>
    authorizeOptimizerRun(tx, {
      userId,
      runId: run.id,
      now: new Date(),
      plannedExpiresAt: run.plannedExpiresAt,
      expectedConfigRevision: input.expectedConfigRevision,
      expectedDraftRevision: input.expectedDraftRevision ?? null,
      model: {
        providerKind: selection.providerKind,
        modelId: selection.modelId,
        readinessFingerprint: selection.storedFingerprint,
      },
    }),
  );
  if (!authorized) {
    throw stalePlanError("concurrent_change");
  }
  return {
    runId: run.id,
    state: authorized.state as OptimizerAuthorizeResult["state"],
  };
}

function stalePlanError(reason: string) {
  return appError({
    appCode: APP_ERROR_CODES.AI_OPTIMIZATION_PLAN_STALE,
    message: "The plan no longer matches current state.",
    status: 409,
    details: { staleReason: reason },
  });
}

/* ------------------------------------------------------------------------- *
 * Status, item list, cancellation, rejection
 * ------------------------------------------------------------------------- */

function toRunSummary(
  run: AiToolOptimizationRun,
  counts: Record<string, number>,
): OptimizerRunSummary {
  const parsedScope = optimizerScopeSchema.safeParse(run.scope);
  return {
    id: run.id,
    serverId: run.serverId,
    source: run.source as OptimizerRunSummary["source"],
    scopeKind: run.scopeKind as OptimizerRunSummary["scopeKind"],
    scope: parsedScope.success ? parsedScope.data : { kind: "all_eligible" },
    state: run.state as OptimizerRunSummary["state"],
    policyVersion: run.policyVersion,
    promptVersion: run.promptVersion,
    providerKind: run.providerKind,
    modelId: run.modelId,
    progress: {
      total: run.eligibleCount,
      queued: counts.queued ?? 0,
      running: counts.running ?? 0,
      recommended: counts.recommended ?? 0,
      noChange: counts.no_change ?? 0,
      failed: counts.failed ?? 0,
      cancelled: counts.cancelled ?? 0,
      applied: counts.applied ?? 0,
      rejected: counts.rejected ?? 0,
    },
    authorizedAt: run.authorizedAt,
    completedAt: run.completedAt,
    cancelRequested: run.cancelRequestedAt !== null,
    errorCode: run.errorCode,
    createdAt: run.createdAt,
    expiresAt: run.retentionExpiresAt,
  };
}

/** Owner-visible run status with live progress counts. */
export async function getOptimizationStatus(
  deps: AiOptimizerDeps,
  userId: string,
  runId: string,
): Promise<OptimizerRunSummary> {
  const run = requireRunForOwner(
    await getOptimizerRunForOwner(deps.db, { userId, runId }),
  );
  const counts = await getOptimizerProgress(deps.db, { runId });
  return toRunSummary(run, counts);
}

export async function listOptimizationRuns(
  deps: AiOptimizerDeps,
  userId: string,
  input: { serverId: string; page: number; pageSize: number },
) {
  await requireOwnedServer(deps.db, userId, input.serverId);
  const { listOptimizerRunsForOwner } =
    await import("./ai-optimizer-repository.js");
  const page = await listOptimizerRunsForOwner(deps.db, {
    userId,
    serverId: input.serverId,
    page: input.page,
    pageSize: input.pageSize,
  });
  const summaries = await Promise.all(
    page.rows.map(async (run) =>
      toRunSummary(run, await getOptimizerProgress(deps.db, { runId: run.id })),
    ),
  );
  return {
    items: summaries,
    page: input.page,
    pageSize: input.pageSize,
    total: page.total,
  };
}

function toItemSummary(item: {
  id: string;
  refKind: string;
  toolId: string | null;
  operationKey: string | null;
  name: string;
  state: string;
  fingerprint: string;
  review: unknown;
  failureCode: string | null;
  appliedDraftRevision: number | null;
  updatedAt: Date;
}): OptimizerItemSummary {
  const review = parseItemReview(item.review);
  return {
    id: item.id,
    ref:
      item.refKind === "draft_tool"
        ? { kind: "draft_tool", toolId: item.toolId ?? "" }
        : {
            kind: "openapi_candidate",
            operationKey: item.operationKey ?? "",
          },
    name: item.name,
    state: item.state as OptimizerItemSummary["state"],
    fingerprint: item.fingerprint,
    operationCount: review.operations.length,
    advisoryCount: review.advisories.length,
    rejectedCount: review.rejected.length,
    failureCode: item.failureCode,
    appliedDraftRevision: item.appliedDraftRevision,
    updatedAt: item.updatedAt,
  };
}

function parseItemReview(raw: unknown): OptimizerItemReview {
  const parsed = optimizerItemReviewSchema.safeParse(raw);
  return parsed.success
    ? parsed.data
    : { operations: [], advisories: [], rejected: [] };
}

export async function listOptimizationItems(
  deps: AiOptimizerDeps,
  userId: string,
  input: OptimizerListItemsInput,
): Promise<OptimizerPaginatedItems> {
  const run = requireRunForOwner(
    await getOptimizerRunForOwner(deps.db, { userId, runId: input.runId }),
  );
  const page = await listOptimizerItemsPage(deps.db, {
    runId: run.id,
    page: input.page,
    pageSize: input.pageSize,
    state: input.state,
  });
  return {
    items: page.rows.map(toItemSummary),
    page: input.page,
    pageSize: input.pageSize,
    total: page.total,
  };
}

/** One item with its full server-owned review artifacts. */
export async function getOptimizationItem(
  deps: AiOptimizerDeps,
  userId: string,
  runId: string,
  itemId: string,
): Promise<OptimizerItemSummary & { review: OptimizerItemReview }> {
  const item = await getOptimizerItemForOwner(deps.db, {
    userId,
    runId,
    itemId,
  });
  if (!item) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_OPTIMIZATION_ITEM_NOT_FOUND,
      message: "Optimization item not found.",
      status: 404,
    });
  }
  const review = parseItemReview(item.review);
  // Persisted-only field: never part of a client projection.
  const clientReview: OptimizerItemReview = {
    operations: review.operations,
    advisories: review.advisories,
    rejected: review.rejected,
  };
  return { ...toItemSummary(item), review: clientReview };
}

export async function cancelOptimization(
  deps: AiOptimizerDeps,
  userId: string,
  runId: string,
): Promise<OptimizerCancelResult> {
  const cancelNow = new Date();
  const existing = await getOptimizerRunForOwner(deps.db, {
    userId,
    runId,
  });
  if (!existing) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_OPTIMIZATION_RUN_NOT_FOUND,
      message: "Optimization run not found.",
      status: 404,
    });
  }
  const result = await deps.db.transaction(async (tx) =>
    requestOptimizerCancel(tx, {
      userId,
      runId,
      now: cancelNow,
      retentionExpiresAt: new Date(
        cancelNow.getTime() +
          AI_TOOL_OPTIMIZATION_LIMITS.retentionDays * 86_400_000,
      ),
    }),
  );
  if (!result) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_OPTIMIZATION_STATE_INVALID,
      message: "This optimization run is no longer cancellable.",
      status: 409,
    });
  }
  return {
    runId: result.id,
    state: result.state as OptimizerCancelResult["state"],
  };
}

export async function rejectOptimizationItem(
  deps: AiOptimizerDeps,
  userId: string,
  runId: string,
  itemId: string,
): Promise<OptimizerRejectResult> {
  const run = requireRunForOwner(
    await getOptimizerRunForOwner(deps.db, { userId, runId }),
  );
  const ok = await deps.db.transaction(async (tx) =>
    rejectOptimizerItem(tx, {
      userId,
      runId: run.id,
      itemId,
      now: new Date(),
    }),
  );
  if (!ok) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_OPTIMIZATION_STATE_INVALID,
      message: "Only recommended items can be rejected.",
      status: 409,
    });
  }
  return { runId: run.id, itemId, state: "rejected" };
}

/* ------------------------------------------------------------------------- *
 * Atomic draft application
 * ------------------------------------------------------------------------- */

function parseTxCommonEntries(server: {
  commonEntries: unknown;
}): McpCommonEntries {
  const parsed = mcpCommonEntriesSchema.safeParse(server.commonEntries);
  return parsed.success ? parsed.data : { headers: [], query: [] };
}

function parseTxAuth(raw: unknown): McpAuthConfiguration | null {
  if (!raw) return null;
  const parsed = mcpAuthConfigurationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function txBasePath(baseUrl: string): string {
  try {
    return new URL(baseUrl).pathname || "/";
  } catch {
    return "/";
  }
}

/**
 * Applies owner-selected operations to the mutable draft through one atomic
 * server write command. Rechecks run/item ownership, policy version, tool
 * fingerprints, current policy, compilation, security, and cross-tool name
 * uniqueness; everything commits or rolls back together. Repeating a
 * committed key returns the original result without touching revisions.
 */
export async function applyOptimizationToDraft(
  deps: AiOptimizerDeps,
  userId: string,
  input: OptimizerApplyDraftInput,
): Promise<OptimizerApplyDraftResult> {
  const committed = await findOptimizerApplyCommitted(deps.db, {
    userId,
    runId: input.runId,
    applyKey: input.applyKey,
  });
  if (committed) {
    // A repeated key replays only with the exact same selections; any
    // difference fails closed.
    const stored = committed as {
      result?: OptimizerApplyDraftResult;
      selections?: OptimizerApplyDraftInput["selections"];
    };
    if (
      JSON.stringify(stored.selections ?? null) !==
      JSON.stringify(input.selections)
    ) {
      throw applyConflictError();
    }
    return optimizerApplyDraftResultSchema.parse(stored.result);
  }

  const run = requireRunForOwner(
    await getOptimizerRunForOwner(deps.db, { userId, runId: input.runId }),
  );
  if (run.state !== "completed" && run.state !== "completed_with_errors") {
    throw appError({
      appCode: APP_ERROR_CODES.AI_OPTIMIZATION_STATE_INVALID,
      message: "Only a completed run can be applied.",
      status: 409,
    });
  }
  if (run.source !== "draft") {
    throw appError({
      appCode: APP_ERROR_CODES.AI_OPTIMIZATION_STATE_INVALID,
      message: "Only draft runs apply through this endpoint.",
      status: 409,
    });
  }
  if (run.policyVersion !== POLICY_VERSION) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_OPTIMIZATION_POLICY_UNSUPPORTED,
      message: "The run uses a policy version this build cannot apply.",
      status: 409,
    });
  }

  const appliedClassCounts = { safe: 0, guarded: 0 };
  const write = await withOwnedServerWrite(
    deps.db,
    {
      userId,
      serverId: run.serverId,
      expectedRevision: input.expectedConfigRevision,
    },
    async (ctx) => {
      const now = new Date();
      // Lock the run row (after the server lock) for idempotency and state.
      const [runRow] = await ctx.tx
        .select()
        .from(aiToolOptimizationRun)
        .where(eq(aiToolOptimizationRun.id, run.id))
        .for("update")
        .limit(1);
      if (!runRow) {
        throw appError({
          appCode: APP_ERROR_CODES.AI_OPTIMIZATION_RUN_NOT_FOUND,
          message: "Optimization run not found.",
          status: 404,
        });
      }
      if (runRow.applyKey) {
        if (runRow.applyKey === input.applyKey) {
          return {
            replay: true as const,
            stored: runRow.applyResult as Record<string, unknown>,
          };
        }
        throw applyConflictError();
      }
      if (runRow.policyVersion !== POLICY_VERSION) {
        throw appError({
          appCode: APP_ERROR_CODES.AI_OPTIMIZATION_POLICY_UNSUPPORTED,
          message: "The run uses a policy version this build cannot apply.",
          status: 409,
        });
      }

      const selectedIds = input.selections.map((selection) => selection.itemId);
      const itemRows = await ctx.tx
        .select()
        .from(aiToolOptimizationItem)
        .where(
          and(
            eq(aiToolOptimizationItem.runId, run.id),
            inArray(aiToolOptimizationItem.id, selectedIds),
          ),
        )
        .for("update");
      const itemById = new Map(itemRows.map((item) => [item.id, item]));
      for (const selection of input.selections) {
        const item = itemById.get(selection.itemId);
        if (!item || item.state !== "recommended") {
          throw appError({
            appCode: APP_ERROR_CODES.AI_OPTIMIZATION_STATE_INVALID,
            message: "A selected item is no longer reviewable.",
            status: 409,
          });
        }
      }

      // Current server aggregate context (inside the locked transaction).
      const serverValues = await ctx.tx
        .select({
          id: mcpServerVariable.id,
          name: mcpServerVariable.name,
          kind: mcpServerVariable.kind,
          owner: mcpServerVariable.owner,
        })
        .from(mcpServerVariable)
        .where(eq(mcpServerVariable.serverId, ctx.server.id));
      const compileBase = {
        common: parseTxCommonEntries(ctx.server),
        auth: parseTxAuth(ctx.server.authConfiguration),
        serverValues: serverValues.map((row) => ({
          id: row.id,
          name: row.name,
          kind: row.kind as "config" | "secret",
          owner: row.owner as "manual" | "auth",
        })),
        basePath: txBasePath(ctx.server.baseUrl),
      };

      const toolRows = await ctx.tx
        .select()
        .from(mcpTool)
        .where(eq(mcpTool.serverId, ctx.server.id));
      const toolsById = new Map(toolRows.map((tool) => [tool.id, tool]));
      const existingToolNames = toolRows.map((tool) => tool.name);

      // Revalidate each selected item against the CURRENT policy and draft.
      const updates: Array<{
        itemId: string;
        toolId: string;
        toolName: string;
        patch: Partial<typeof mcpTool.$inferInsert>;
      }> = [];
      const takenNames = new Set(existingToolNames);
      for (const selection of input.selections) {
        const item = itemById.get(selection.itemId)!;
        const review = item.review as {
          sourceOperations?: OptimizerOperation[];
        } | null;
        const sourceOperations = review?.sourceOperations ?? [];
        const byId = new Map(
          sourceOperations.map((op) => [op.operationId, op]),
        );
        const selectedOps = selection.operationIds.map((opId) => {
          const op = byId.get(opId);
          if (!op) {
            throw appError({
              appCode: APP_ERROR_CODES.AI_OPTIMIZATION_APPLY_INVALID,
              message: "A selected operation is no longer known to the run.",
              status: 422,
              details: { runId: run.id, itemId: item.id },
            });
          }
          return op;
        });

        const toolId = item.toolId;
        const tool = toolId ? toolsById.get(toolId) : undefined;
        if (!tool) {
          throw appError({
            appCode: APP_ERROR_CODES.AI_OPTIMIZATION_APPLY_STALE,
            message: "The reviewed tool no longer exists.",
            status: 409,
            details: { runId: run.id, staleReason: "tool_removed" },
          });
        }
        const snapshotResult = sanitizeDraftTool({
          kind: "draft",
          toolId: tool.id,
          name: tool.name,
          title: tool.title,
          description: tool.description,
          method: tool.method,
          requestDefinition: tool.requestDefinition,
          compileIssues: tool.compileIssues ?? null,
        });
        if (
          !snapshotResult.ok ||
          snapshotResult.fingerprint !== item.fingerprint
        ) {
          throw appError({
            appCode: APP_ERROR_CODES.AI_OPTIMIZATION_APPLY_STALE,
            message: "The reviewed tool changed after authorization.",
            status: 409,
            details: { runId: run.id, staleReason: "tool_drift" },
          });
        }
        const definitionParsed = mcpRequestDefinitionSchema.safeParse(
          tool.requestDefinition,
        );
        if (!definitionParsed.success) {
          throw appError({
            appCode: APP_ERROR_CODES.AI_OPTIMIZATION_APPLY_STALE,
            message: "The reviewed tool definition is no longer parseable.",
            status: 409,
            details: { runId: run.id, staleReason: "tool_drift" },
          });
        }

        const applied = applySelectedOperations({
          snapshot: snapshotResult.snapshot,
          definition: definitionParsed.data,
          startName: tool.name,
          startTitle: tool.title ?? undefined,
          startDescription: tool.description ?? undefined,
          operations: selectedOps,
          compile: {
            ...compileBase,
            allowMutation: tool.allowMutation,
          },
          existingToolNames: [...takenNames],
        });
        if (!applied.ok) {
          throw appError({
            appCode: APP_ERROR_CODES.AI_OPTIMIZATION_APPLY_INVALID,
            message: "A selected recommendation failed current validation.",
            status: 422,
            details: { runId: run.id, itemId: item.id },
          });
        }
        if (applied.state.toolName !== tool.name) {
          if (takenNames.has(applied.state.toolName)) {
            throw appError({
              appCode: APP_ERROR_CODES.AI_OPTIMIZATION_APPLY_INVALID,
              message: "A selected tool name conflicts with an existing tool.",
              status: 422,
              details: { runId: run.id, itemId: item.id },
            });
          }
          takenNames.delete(tool.name);
          takenNames.add(applied.state.toolName);
        }

        // Full canonical compilation of the resulting tool.
        const compiled = compileToolDefinition({
          method: tool.method,
          definition: applied.state.definition,
          ...compileBase,
          allowMutation: tool.allowMutation,
        });
        if (!compiled.ok) {
          throw appError({
            appCode: APP_ERROR_CODES.AI_OPTIMIZATION_APPLY_INVALID,
            message: "A resulting tool failed canonical compilation.",
            status: 422,
            details: { runId: run.id, itemId: item.id },
          });
        }

        for (const op of selectedOps) {
          const opClass = optimizerOperationClass(op.kind);
          if (opClass) appliedClassCounts[opClass] += 1;
        }
        updates.push({
          itemId: item.id,
          toolId: tool.id,
          toolName: applied.state.toolName,
          patch: {
            name: applied.state.toolName,
            title: applied.state.toolTitle ?? null,
            description: applied.state.toolDescription ?? null,
            requestDefinition: applied.state.definition,
            compiledPlan: compiled.plan as unknown as Record<string, unknown>,
            compileStatus: "valid",
            compileIssues: compiled.issues,
            updatedAt: now,
          },
        });
      }

      // Write every selected tool update or none.
      const appliedItems: OptimizerApplyDraftResult["applied"] = [];
      for (const update of updates) {
        await ctx.tx
          .update(mcpTool)
          .set(update.patch)
          .where(eq(mcpTool.id, update.toolId));
        appliedItems.push({
          itemId: update.itemId,
          toolId: update.toolId,
          toolName: update.toolName,
        });
      }

      // One config/draft revision increment for the whole batch.
      const [updatedServer] = await ctx.tx
        .update(mcpServer)
        .set({
          configRevision: ctx.server.configRevision + 1,
          draftRevision: ctx.server.draftRevision + 1,
          updatedAt: now,
        })
        .where(eq(mcpServer.id, ctx.server.id))
        .returning({
          configRevision: mcpServer.configRevision,
          draftRevision: mcpServer.draftRevision,
        });

      const result: OptimizerApplyDraftResult = {
        runId: run.id,
        configRevision: updatedServer!.configRevision,
        draftRevision: updatedServer!.draftRevision,
        applied: appliedItems,
      };
      await markOptimizerItemsApplied(ctx.tx, {
        runId: run.id,
        now,
        draftRevision: result.draftRevision,
        items: appliedItems.map((entry) => ({
          itemId: entry.itemId,
          appliedToolId: entry.toolId,
          appliedToolName: entry.toolName,
        })),
      });
      await commitOptimizerApplyMarker(ctx.tx, {
        runId: run.id,
        applyKey: input.applyKey,
        applyResult: {
          result,
          selections: input.selections,
        } as unknown as Record<string, unknown>,
        configRevision: result.configRevision,
        draftRevision: result.draftRevision,
        now,
      });
      return { replay: false as const, result };
    },
    {
      // Revisions are incremented exactly once inside the command above.
      finalizeRevision: false,
      draftMutation: true,
      expectedDraftRevision: input.expectedDraftRevision,
    },
  );

  if (write.result.replay) {
    const stored = write.result.stored as {
      result?: OptimizerApplyDraftResult;
      selections?: OptimizerApplyDraftInput["selections"];
    };
    if (
      JSON.stringify(stored.selections ?? null) !==
      JSON.stringify(input.selections)
    ) {
      throw applyConflictError();
    }
    return optimizerApplyDraftResultSchema.parse(stored.result);
  }
  captureMcpTelemetry(MCP_TELEMETRY_EVENTS.optimizerApplied, {
    db: deps.db,
    userId,
    properties: {
      sourceKind: "draft",
      runId: run.id,
      appliedCount: write.result.result.applied.length,
      safeOperationCount: appliedClassCounts.safe,
      guardedOperationCount: appliedClassCounts.guarded,
      configRevision: write.result.result.configRevision,
      draftRevision: write.result.result.draftRevision,
    },
  });
  return write.result.result;
}

function applyConflictError() {
  return appError({
    appCode: APP_ERROR_CODES.AI_OPTIMIZATION_IDEMPOTENCY_CONFLICT,
    message: "The apply key was already used with different operations.",
    status: 409,
  });
}
