/**
 * @file Owner-scoped OpenAPI import: one write-free preview and one
 * fingerprint-bound aggregate confirmation.
 *
 * Preview only reads the owner-scoped server aggregate. Confirmation resolves
 * and parses the source, verifies the previewed document fingerprint, maps the
 * selection, plans group placement, and then runs one `withOwnedServerWrite`
 * transaction that locks the server, revalidates capacity/names/group
 * ownership, recompiles every selected definition against the locked
 * aggregate, and inserts disabled draft tools with typed provenance.
 *
 * Secrets never cross this boundary: authentication, common entries, and
 * server values are consumed as compile-time configuration only, and the
 * persisted provenance excludes the document body, examples, and raw URLs.
 */
import { MCP_OPENAPI_LIMITS, MCP_TOOL_GROUP_LIMITS } from "@repo/core";
import {
  generateId,
  mcpServer,
  mcpServerVariable,
  mcpTool,
  mcpToolGroup,
  type McpServer,
} from "@repo/db";
import { and, count, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { APP_ERROR_CODES, appError } from "../lib/app-error.js";
import {
  compileToolDefinition,
  type CompileServerValueRef,
} from "../lib/mcp-compiler.js";
import {
  MCP_FIELD_LIMITS,
  mcpAuthConfigurationSchema,
  mcpCommonEntriesSchema,
  type McpAuthConfiguration,
  type McpCommonEntries,
  type McpCompileIssue,
  type McpRequestDefinition,
} from "../lib/mcp-request-definition.js";
import { getMcpMaxToolsPerServer } from "../lib/mcp-limits.js";
import {
  captureMcpTelemetry,
  MCP_TELEMETRY_EVENTS,
} from "../lib/mcp-telemetry.js";
import {
  parseOpenApiDocument,
  suggestMcpToolName,
} from "../lib/openapi-document.js";
import { fetchOpenApiDocument } from "../lib/openapi-fetch.js";
import {
  MCP_OPENAPI_PROVENANCE_VERSION,
  mcpOpenApiSourceProvenanceSchema,
  type McpOpenApiCapacityProjection,
  type McpOpenApiConfirmInput,
  type McpOpenApiConfirmResult,
  type McpOpenApiDocumentSummary,
  type McpOpenApiGroupStrategy,
  type McpOpenApiInventory,
  type McpOpenApiOperationCandidate,
  type McpOpenApiOperationIssue,
  type McpOpenApiPreviewResult,
  type McpOpenApiSelectionEntry,
  type McpOpenApiSource,
  type McpOpenApiSourceProvenance,
  type McpOpenApiSuggestedGroup,
} from "../lib/openapi-import-contracts.js";
import { mapInventoryOperation } from "../lib/openapi-mapper.js";
import {
  isUniqueViolation,
  withOwnedServerWrite,
} from "./mcp-server-command.js";
import {
  normalizeToolGroupName,
  validateToolGroupName,
} from "./mcp-tool-group-service.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

/** Canonical MCP-safe tool-name shape produced by `suggestMcpToolName`. */
const MCP_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * A blocked candidate's `method` is not meaningful — the mapper omits it for an
 * unsupported HTTP method, but the candidate contract requires a supported
 * value. The `OPENAPI_METHOD_UNSUPPORTED` issue carries the real diagnostic and
 * `selectable: false` prevents selection.
 */
const BLOCKED_CANDIDATE_METHOD = "GET" as const;

export type PreviewOpenApiImportInput = { source: McpOpenApiSource };

/** Server configuration the canonical compiler consumes for one import. */
type ImportCompileContext = {
  server: McpServer;
  common: McpCommonEntries;
  auth: McpAuthConfiguration | null;
  servers: CompileServerValueRef[];
  basePath: string;
};

type SelectableCandidate = McpOpenApiOperationCandidate & {
  requestDefinition: McpRequestDefinition;
};

type OwnerToolGroup = {
  id: string;
  name: string;
  normalizedName: string;
};

type GroupAssignment =
  | { kind: "ungrouped" }
  | { kind: "existing"; groupId: string }
  | { kind: "create"; name: string; normalizedName: string };

type GroupPlan = {
  /** One decision per selected operation key. */
  assignments: Map<string, GroupAssignment>;
  /** Groups to create, deduplicated by normalized name. */
  creations: Array<{ name: string; normalizedName: string }>;
};

/* ------------------------------------------------------------------------- *
 * Source resolution
 * ------------------------------------------------------------------------- */

/**
 * Resolves exactly one source into bounded document text plus its sanitized
 * label. Content is used verbatim; URL labels come from the fetcher already
 * stripped of query, fragment, and userinfo. Size limits stay owned by
 * `parseOpenApiDocument` (content) and `fetchOpenApiDocument` (URL).
 */
export async function resolveOpenApiSource(source: McpOpenApiSource): Promise<{
  text: string;
  sourceLabel: string;
  sourceKind: "content" | "url";
}> {
  if (source.kind === "content") {
    return {
      text: source.content,
      sourceLabel: source.label === "file" ? "uploaded file" : "pasted JSON",
      sourceKind: "content",
    };
  }
  const fetched = await fetchOpenApiDocument({ url: source.url });
  return {
    text: fetched.text,
    // Final sanitized label after redirects: the only URL form safe to persist.
    sourceLabel: fetched.sourceLabel,
    sourceKind: "url",
  };
}

/* ------------------------------------------------------------------------- *
 * Owner-scoped reads
 * ------------------------------------------------------------------------- */

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

async function loadExistingToolNames(
  db: DB,
  serverId: string,
): Promise<string[]> {
  const rows = await db
    .select({ name: mcpTool.name })
    .from(mcpTool)
    .where(eq(mcpTool.serverId, serverId));
  return rows.map((row) => row.name);
}

/** Bounded by the group cap, so the whole owner group set is read unpaginated. */
async function loadOwnerToolGroups(
  db: DB,
  serverId: string,
): Promise<OwnerToolGroup[]> {
  return db
    .select({
      id: mcpToolGroup.id,
      name: mcpToolGroup.name,
      normalizedName: mcpToolGroup.normalizedName,
    })
    .from(mcpToolGroup)
    .where(eq(mcpToolGroup.serverId, serverId));
}

async function loadCompileServerValueRefs(
  db: DB,
  serverId: string,
): Promise<CompileServerValueRef[]> {
  // Identity-only projection: import never reads a stored value or ciphertext,
  // only the names and kinds the canonical compiler consumes.
  const rows = await db
    .select({
      id: mcpServerVariable.id,
      name: mcpServerVariable.name,
      kind: mcpServerVariable.kind,
      owner: mcpServerVariable.owner,
    })
    .from(mcpServerVariable)
    .where(eq(mcpServerVariable.serverId, serverId));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind as "config" | "secret",
    owner: row.owner as "manual" | "auth",
  }));
}

function parseCommonEntries(server: McpServer): McpCommonEntries {
  if (!server.commonEntries) return { headers: [], query: [] };
  const parsed = mcpCommonEntriesSchema.safeParse(server.commonEntries);
  return parsed.success ? parsed.data : { headers: [], query: [] };
}

function parseAuthConfiguration(raw: unknown): McpAuthConfiguration | null {
  if (!raw) return null;
  const parsed = mcpAuthConfigurationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function serverBasePath(baseUrl: string): string {
  try {
    return new URL(baseUrl).pathname || "/";
  } catch {
    return "/";
  }
}

/* ------------------------------------------------------------------------- *
 * Candidate mapping and compilation
 * ------------------------------------------------------------------------- */

/**
 * Stable blocking diagnostic for a canonical compile gap. The mapper's
 * `openApiIssue` helper only accepts OpenAPI issue codes, so this entry carries
 * the localizable `MCP_COMPILE_INVALID` application code instead.
 */
function compileBlockingIssue(
  message: string,
  pointer?: string,
): McpOpenApiOperationIssue {
  return {
    code: APP_ERROR_CODES.MCP_COMPILE_INVALID,
    severity: "error",
    message,
    ...(pointer !== undefined ? { path: pointer } : {}),
  };
}

/**
 * Maps every inventory operation in document order and compiles each
 * representable definition against the supplied server configuration. Names
 * already claimed by an earlier selectable candidate block later duplicates, so
 * collisions are resolved deterministically rather than silently suffixed.
 */
function buildCandidates(input: {
  inventory: McpOpenApiInventory;
  existingToolNames: readonly string[];
  compile: ImportCompileContext;
  nameOverrides?: ReadonlyMap<string, string>;
}): McpOpenApiOperationCandidate[] {
  const claimedNames: string[] = [];
  const candidates: McpOpenApiOperationCandidate[] = [];

  for (const operation of input.inventory.operations) {
    const override = input.nameOverrides?.get(operation.operationKey);
    const mapped = mapInventoryOperation({
      operation,
      document: input.inventory.document,
      serverBaseUrl: input.compile.server.baseUrl,
      suggestedName: suggestMcpToolName(operation),
      existingToolNames: input.existingToolNames,
      claimedNames,
      ...(override !== undefined ? { nameOverride: override } : {}),
    });

    const issues: McpOpenApiOperationIssue[] = [...mapped.issues];
    let selectable = mapped.selectable;
    let compileIssues: McpCompileIssue[] = [];

    if (mapped.requestDefinition !== undefined && mapped.method !== undefined) {
      const compiled = compileToolDefinition({
        method: mapped.method,
        definition: mapped.requestDefinition,
        common: input.compile.common,
        auth: input.compile.auth,
        serverValues: input.compile.servers,
        basePath: input.compile.basePath,
        allowMutation: false,
      });
      compileIssues = compiled.issues;
      if (!compiled.ok) {
        selectable = false;
        issues.push(
          compileBlockingIssue(
            "The mapped operation does not compile against this server's configuration.",
            operation.pointer,
          ),
        );
      }
    }

    if (selectable) claimedNames.push(mapped.name);

    candidates.push({
      operationKey: mapped.operationKey,
      method: mapped.method ?? BLOCKED_CANDIDATE_METHOD,
      path: mapped.path,
      ...(operation.operationId !== undefined
        ? { operationId: operation.operationId }
        : {}),
      // Credential-scrubbed prose only: the mapper is the single place that
      // sanitizes document text, so raw operation fields never reach a row.
      ...(mapped.title !== undefined ? { title: mapped.title } : {}),
      ...(mapped.description !== undefined
        ? { description: mapped.description }
        : {}),
      tags: mapped.tags,
      deprecated: mapped.deprecated,
      suggestedName: mapped.name,
      selectable,
      issues,
      security: mapped.security,
      ...(mapped.requestDefinition !== undefined
        ? { requestDefinition: mapped.requestDefinition }
        : {}),
      compileIssues,
    });
  }

  return candidates;
}

/** First-tag suggestions: reuse by normalized name, otherwise plan a creation. */
function buildSuggestedGroups(
  candidates: readonly McpOpenApiOperationCandidate[],
  groups: readonly OwnerToolGroup[],
): McpOpenApiSuggestedGroup[] {
  const existingGroupIdByNormalizedName = new Map(
    groups.map((group) => [group.normalizedName, group.id]),
  );
  const suggestions = new Map<string, McpOpenApiSuggestedGroup>();

  for (const candidate of candidates) {
    if (!candidate.selectable) continue;
    const tag = candidate.tags[0];
    if (tag === undefined) continue;
    const normalizedName = normalizeToolGroupName(tag);
    if (normalizedName.length === 0 || suggestions.has(normalizedName))
      continue;
    const existingGroupId = existingGroupIdByNormalizedName.get(normalizedName);
    suggestions.set(normalizedName, {
      tag,
      normalizedName,
      ...(existingGroupId !== undefined ? { existingGroupId } : {}),
      willCreate: existingGroupId === undefined,
    });
  }

  return [...suggestions.values()];
}

/* ------------------------------------------------------------------------- *
 * Preview
 * ------------------------------------------------------------------------- */

export async function previewOpenApiImport(
  db: DB,
  userId: string,
  serverId: string,
  input: PreviewOpenApiImportInput,
): Promise<McpOpenApiPreviewResult> {
  const startedAt = Date.now();
  const server = await requireOwnedServer(db, userId, serverId);
  const resolved = await resolveOpenApiSource(input.source);
  const inventory = parseOpenApiDocument(resolved.text);

  const existingToolNames = await loadExistingToolNames(db, server.id);
  const groups = await loadOwnerToolGroups(db, server.id);
  const servers = await loadCompileServerValueRefs(db, server.id);

  const candidates = buildCandidates({
    inventory,
    existingToolNames,
    compile: {
      server,
      common: parseCommonEntries(server),
      auth: parseAuthConfiguration(server.authConfiguration),
      servers,
      basePath: serverBasePath(server.baseUrl),
    },
  });
  const suggestedGroups = buildSuggestedGroups(candidates, groups);

  const document: McpOpenApiDocumentSummary = {
    version: inventory.document.version,
    ...(inventory.document.title !== undefined
      ? { title: inventory.document.title }
      : {}),
    fingerprint: inventory.document.fingerprint,
    operationCount: inventory.operations.length,
    selectableCount: candidates.filter((candidate) => candidate.selectable)
      .length,
  };

  const capacity: McpOpenApiCapacityProjection = {
    toolLimit: getMcpMaxToolsPerServer(),
    currentTools: existingToolNames.length,
    groupLimit: MCP_TOOL_GROUP_LIMITS.maxGroupsPerServer,
    currentGroups: groups.length,
  };

  captureMcpTelemetry(MCP_TELEMETRY_EVENTS.openapiImportPreviewed, {
    db,
    userId,
    properties: {
      sourceKind: resolved.sourceKind,
      openApiVersion: document.version,
      operationCount: document.operationCount,
      selectableCount: document.selectableCount,
      blockedCount: document.operationCount - document.selectableCount,
      warningCount: candidates.reduce(
        (total, candidate) =>
          total +
          candidate.issues.filter((issue) => issue.severity === "warning")
            .length,
        0,
      ),
      issueCodes: stableIssueCodes(candidates),
      suggestedGroupCount: suggestedGroups.length,
      currentToolCount: capacity.currentTools,
      currentGroupCount: capacity.currentGroups,
      durationMs: Date.now() - startedAt,
    },
  });

  return {
    document,
    operations: candidates,
    documentIssues: inventory.documentIssues,
    suggestedGroups,
    capacity,
    sourceLabel: resolved.sourceLabel,
    configRevision: server.configRevision,
  };
}

/** Unique, bounded stable codes only: never messages, pointers, or values. */
function stableIssueCodes(
  candidates: readonly McpOpenApiOperationCandidate[],
): string[] {
  const codes: string[] = [];
  for (const candidate of candidates) {
    for (const issue of candidate.issues) {
      if (codes.includes(issue.code)) continue;
      if (codes.length >= 10) return codes;
      codes.push(issue.code);
    }
  }
  return codes;
}

/* ------------------------------------------------------------------------- *
 * Confirmation planning
 * ------------------------------------------------------------------------- */

function invalidSelection(
  serverId: string,
  message: string,
  details: { operationKeys?: string[]; limit?: number; observed?: number } = {},
): never {
  throw appError({
    appCode: APP_ERROR_CODES.MCP_OPENAPI_INVALID_SELECTION,
    message,
    status: 400,
    details: { serverId, ...details },
  });
}

/** Shape rules only: unknown keys and blockers are validated after mapping. */
function assertSelectionShape(
  selection: readonly McpOpenApiSelectionEntry[],
  serverId: string,
): void {
  const keys = selection.map((entry) => entry.operationKey);
  const uniqueKeys = new Set(keys);
  if (selection.length === 0 || uniqueKeys.size !== keys.length) {
    invalidSelection(
      serverId,
      selection.length === 0
        ? "Select at least one operation to import."
        : "An operation can only be selected once per import.",
      {
        operationKeys:
          selection.length === 0
            ? []
            : keys.filter((key, index) => keys.indexOf(key) !== index),
      },
    );
  }
  if (selection.length > MCP_OPENAPI_LIMITS.maxSelection) {
    invalidSelection(
      serverId,
      `At most ${MCP_OPENAPI_LIMITS.maxSelection} operations can be imported at once.`,
      {
        limit: MCP_OPENAPI_LIMITS.maxSelection,
        observed: selection.length,
      },
    );
  }
  for (const entry of selection) {
    if (entry.name !== undefined && !MCP_TOOL_NAME_PATTERN.test(entry.name)) {
      invalidSelection(
        serverId,
        `"${entry.name}" is not a valid MCP tool name.`,
        { operationKeys: [entry.operationKey] },
      );
    }
  }
}

function assertGroupCapacity(input: {
  existingCount: number;
  plannedCount: number;
  serverId: string;
}): void {
  const limit = MCP_TOOL_GROUP_LIMITS.maxGroupsPerServer;
  if (input.existingCount + input.plannedCount > limit) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TOOL_GROUP_LIMIT_REACHED,
      message: `A server cannot have more than ${limit} tool groups.`,
      status: 400,
      details: {
        serverId: input.serverId,
        limit,
        observed: input.existingCount,
      },
    });
  }
}

function assertGroupNameUnused(input: {
  normalizedNames: ReadonlySet<string>;
  creations: readonly { name: string; normalizedName: string }[];
  serverId: string;
}): void {
  for (const creation of input.creations) {
    if (!input.normalizedNames.has(creation.normalizedName)) continue;
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TOOL_GROUP_NAME_CONFLICT,
      message: "A group with this name already exists on the server.",
      status: 409,
      details: { serverId: input.serverId, groupName: creation.normalizedName },
    });
  }
}

/**
 * Group strategy precedence: an explicitly chosen group (`existing`/`new`)
 * overrides OpenAPI tags entirely; `firstTag` reuses normalized existing groups
 * and plans one creation per missing first tag; operations without a tag stay
 * ungrouped.
 */
function planGroupAssignments(input: {
  strategy: McpOpenApiGroupStrategy;
  selected: readonly SelectableCandidate[];
  groups: readonly OwnerToolGroup[];
  serverId: string;
}): GroupPlan {
  const assignments = new Map<string, GroupAssignment>();
  const assignAll = (
    assignment: GroupAssignment,
    creations: GroupPlan["creations"] = [],
  ): GroupPlan => {
    for (const candidate of input.selected) {
      assignments.set(candidate.operationKey, assignment);
    }
    return { assignments, creations };
  };

  if (input.strategy.kind === "ungrouped") {
    return assignAll({ kind: "ungrouped" });
  }

  if (input.strategy.kind === "existing") {
    const groupId = input.strategy.groupId;
    const group = input.groups.find((entry) => entry.id === groupId);
    if (!group) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_TOOL_GROUP_NOT_FOUND,
        message: "MCP tool group not found.",
        status: 404,
        details: { serverId: input.serverId, groupId },
      });
    }
    return assignAll({ kind: "existing", groupId: group.id });
  }

  if (input.strategy.kind === "new") {
    const name = validateToolGroupName(input.strategy.name);
    const normalizedName = normalizeToolGroupName(name);
    const creations = [{ name, normalizedName }];
    assertGroupNameUnused({
      normalizedNames: new Set(
        input.groups.map((group) => group.normalizedName),
      ),
      creations,
      serverId: input.serverId,
    });
    assertGroupCapacity({
      existingCount: input.groups.length,
      plannedCount: creations.length,
      serverId: input.serverId,
    });
    return assignAll({ kind: "create", name, normalizedName }, creations);
  }

  const existingByNormalizedName = new Map(
    input.groups.map((group) => [group.normalizedName, group]),
  );
  const creations = new Map<string, { name: string; normalizedName: string }>();
  for (const candidate of input.selected) {
    const tag = candidate.tags[0];
    const normalizedName = tag === undefined ? "" : normalizeToolGroupName(tag);
    if (normalizedName.length === 0) {
      assignments.set(candidate.operationKey, { kind: "ungrouped" });
      continue;
    }
    const existing = existingByNormalizedName.get(normalizedName);
    if (existing) {
      assignments.set(candidate.operationKey, {
        kind: "existing",
        groupId: existing.id,
      });
      continue;
    }
    const planned = creations.get(normalizedName) ?? {
      name: validateToolGroupName(tag ?? normalizedName),
      normalizedName,
    };
    creations.set(normalizedName, planned);
    assignments.set(candidate.operationKey, { kind: "create", ...planned });
  }

  assertGroupCapacity({
    existingCount: input.groups.length,
    plannedCount: creations.size,
    serverId: input.serverId,
  });
  return { assignments, creations: [...creations.values()] };
}

/* ------------------------------------------------------------------------- *
 * Confirmation
 * ------------------------------------------------------------------------- */

export async function confirmOpenApiImport(
  db: DB,
  userId: string,
  serverId: string,
  input: McpOpenApiConfirmInput,
): Promise<McpOpenApiConfirmResult> {
  const startedAt = Date.now();
  const server = await requireOwnedServer(db, userId, serverId);
  const resolved = await resolveOpenApiSource(input.source);
  const inventory = parseOpenApiDocument(resolved.text);

  // The parser recomputes the canonical fingerprint on every parse, so this
  // comparison binds the confirmation to the exact document that was previewed.
  const documentFingerprint = inventory.document.fingerprint;
  if (documentFingerprint !== input.fingerprint) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_OPENAPI_STALE_PREVIEW,
      message:
        "The submitted OpenAPI document changed after the preview. Preview it again.",
      status: 409,
      details: { serverId, documentFingerprint, refreshRequired: true },
    });
  }

  assertSelectionShape(input.selection, serverId);

  const existingToolNames = await loadExistingToolNames(db, server.id);
  const groups = await loadOwnerToolGroups(db, server.id);
  const servers = await loadCompileServerValueRefs(db, server.id);

  const nameOverrides = new Map<string, string>();
  for (const entry of input.selection) {
    if (entry.name !== undefined)
      nameOverrides.set(entry.operationKey, entry.name);
  }
  const candidates = buildCandidates({
    inventory,
    existingToolNames,
    nameOverrides,
    compile: {
      server,
      common: parseCommonEntries(server),
      auth: parseAuthConfiguration(server.authConfiguration),
      servers,
      basePath: serverBasePath(server.baseUrl),
    },
  });

  const candidateByKey = new Map(
    candidates.map((candidate) => [candidate.operationKey, candidate]),
  );
  const selected: SelectableCandidate[] = [];
  const rejectedKeys = new Set<string>();
  const selectedNames = new Set<string>();
  for (const entry of input.selection) {
    const candidate = candidateByKey.get(entry.operationKey);
    const definition = candidate?.requestDefinition;
    if (
      candidate === undefined ||
      !candidate.selectable ||
      definition === undefined ||
      selectedNames.has(candidate.suggestedName)
    ) {
      rejectedKeys.add(entry.operationKey);
      continue;
    }
    selectedNames.add(candidate.suggestedName);
    selected.push({ ...candidate, requestDefinition: definition });
  }
  if (rejectedKeys.size > 0) {
    invalidSelection(
      serverId,
      "One or more selected operations are blocked or conflict with an existing tool name.",
      { operationKeys: [...rejectedKeys] },
    );
  }

  const plan = planGroupAssignments({
    strategy: input.groupStrategy,
    selected,
    groups,
    serverId,
  });
  const batchId = generateId("oib");
  const openApiVersion = inventory.document.version;
  const sourceKind = resolved.sourceKind;
  const sourceLabel = resolved.sourceLabel;

  const { result, revision, draftRevision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision: input.expectedRevision },
    async (ctx) => {
      const locked = ctx.server;

      const [toolCountRow] = await ctx.tx
        .select({ count: count() })
        .from(mcpTool)
        .where(eq(mcpTool.serverId, locked.id));
      const currentToolCount = toolCountRow?.count ?? 0;
      const toolLimit = getMcpMaxToolsPerServer();
      if (currentToolCount + selected.length > toolLimit) {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_TOOL_LIMIT_REACHED,
          message: `A server cannot have more than ${toolLimit} tools.`,
          status: 400,
          details: {
            serverId: locked.id,
            limit: toolLimit,
            observed: currentToolCount,
          },
        });
      }

      const lockedGroups = await loadOwnerToolGroups(ctx.tx, locked.id);
      const lockedGroupById = new Map(
        lockedGroups.map((group) => [group.id, group]),
      );
      for (const assignment of plan.assignments.values()) {
        if (assignment.kind !== "existing") continue;
        if (lockedGroupById.has(assignment.groupId)) continue;
        throw appError({
          appCode: APP_ERROR_CODES.MCP_TOOL_GROUP_NOT_FOUND,
          message: "MCP tool group not found.",
          status: 404,
          details: { serverId: locked.id, groupId: assignment.groupId },
        });
      }
      assertGroupCapacity({
        existingCount: lockedGroups.length,
        plannedCount: plan.creations.length,
        serverId: locked.id,
      });
      assertGroupNameUnused({
        normalizedNames: new Set(
          lockedGroups.map((group) => group.normalizedName),
        ),
        creations: plan.creations,
        serverId: locked.id,
      });

      const createdGroupIdByNormalizedName = new Map<string, string>();
      const groupResults: McpOpenApiConfirmResult["groups"] = [];
      for (const creation of plan.creations) {
        try {
          const [created] = await ctx.tx
            .insert(mcpToolGroup)
            .values({
              serverId: locked.id,
              name: creation.name,
              normalizedName: creation.normalizedName,
            })
            .returning();
          createdGroupIdByNormalizedName.set(
            creation.normalizedName,
            created.id,
          );
          groupResults.push({
            id: created.id,
            name: created.name,
            created: true,
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw appError({
              appCode: APP_ERROR_CODES.MCP_TOOL_GROUP_NAME_CONFLICT,
              message: "A group with this name already exists on the server.",
              status: 409,
              details: { serverId: locked.id },
            });
          }
          throw error;
        }
      }

      const lockedServers = await loadCompileServerValueRefs(ctx.tx, locked.id);
      const lockedCommon = parseCommonEntries(locked);
      const lockedAuth = parseAuthConfiguration(locked.authConfiguration);
      const lockedBasePath = serverBasePath(locked.baseUrl);
      const usedGroupIds = new Set<string>();
      const tools: McpOpenApiConfirmResult["tools"] = [];

      for (const candidate of selected) {
        const compiled = compileToolDefinition({
          method: candidate.method,
          definition: candidate.requestDefinition,
          common: lockedCommon,
          auth: lockedAuth,
          serverValues: lockedServers,
          basePath: lockedBasePath,
          allowMutation: false,
        });
        if (!compiled.ok || compiled.plan === null) {
          // Any selected compile gap rolls back the transaction, groups included.
          const first =
            compiled.issues.find((issue) => issue.severity === "error") ??
            compiled.issues[0];
          throw appError({
            appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
            message:
              first?.message ??
              "A selected operation failed to compile against the locked server configuration.",
            status: 409,
            details: {
              ...(first?.path !== undefined ? { path: first.path } : {}),
              ...(first?.code !== undefined ? { issueCode: first.code } : {}),
              ...(first?.id !== undefined ? { nodeId: first.id } : {}),
            },
          });
        }

        const assignment = plan.assignments.get(candidate.operationKey);
        let groupId: string | null = null;
        if (assignment?.kind === "existing") {
          groupId = assignment.groupId;
          usedGroupIds.add(groupId);
        } else if (assignment?.kind === "create") {
          groupId =
            createdGroupIdByNormalizedName.get(assignment.normalizedName) ??
            null;
        }

        const provenance = buildSourceProvenance({
          batchId,
          openApiVersion,
          operationKey: candidate.operationKey,
          documentFingerprint,
          definitionHash: compiled.plan.definitionHash,
          tags: candidate.tags,
          sourceLabel,
        });

        try {
          const [created] = await ctx.tx
            .insert(mcpTool)
            .values({
              serverId: locked.id,
              name: candidate.suggestedName,
              title: boundedOptionalText(
                candidate.title,
                MCP_FIELD_LIMITS.toolTitle,
              ),
              description: boundedOptionalText(
                candidate.description,
                MCP_FIELD_LIMITS.description,
              ),
              method: candidate.method,
              requestDefinition:
                candidate.requestDefinition as unknown as Record<
                  string,
                  unknown
                >,
              compiledPlan: compiled.plan as unknown as Record<string, unknown>,
              compileStatus: "valid",
              compileIssues: compiled.issues,
              annotations: (compiled.plan.annotations ?? null) as Record<
                string,
                unknown
              > | null,
              // Imported tools always start disabled with mutation gated off.
              allowMutation: false,
              enabled: false,
              source: "openapi",
              sourceProvenance: provenance as unknown as Record<
                string,
                unknown
              >,
              groupId,
            })
            .returning({ id: mcpTool.id, name: mcpTool.name });
          tools.push({
            id: created.id,
            name: created.name,
            method: candidate.method,
            path: candidate.path,
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw appError({
              appCode: APP_ERROR_CODES.MCP_TOOL_NAME_CONFLICT,
              message: "A tool with this name already exists on the server.",
              status: 409,
              details: {
                serverId: locked.id,
                toolNames: [candidate.suggestedName],
              },
            });
          }
          throw error;
        }
      }

      const usedGroupResults: McpOpenApiConfirmResult["groups"] = [];
      for (const group of lockedGroups) {
        if (!usedGroupIds.has(group.id)) continue;
        usedGroupResults.push({
          id: group.id,
          name: group.name,
          created: false,
        });
      }
      const groupsResult = [...usedGroupResults, ...groupResults];

      ctx.onCommit(() => {
        captureMcpTelemetry(MCP_TELEMETRY_EVENTS.openapiImportConfirmed, {
          db,
          userId,
          properties: {
            sourceKind,
            openApiVersion,
            selectedCount: selected.length,
            createdToolCount: tools.length,
            createdGroupCount: groupResults.length,
            durationMs: Date.now() - startedAt,
          },
        });
      });

      return { batchId, tools, groups: groupsResult };
    },
    // New draft tools are publishable structure; the helper owns both revisions.
    { draftMutation: true },
  );

  return {
    revision,
    draftRevision,
    batchId: result.batchId,
    tools: result.tools,
    groups: result.groups,
  };
}

/**
 * Persisted metadata values are bounded by the transport contract; over-limit
 * document metadata is dropped rather than silently truncated.
 */
function boundedOptionalText(
  value: string | undefined,
  limit: number,
): string | null {
  const text = value?.trim();
  if (!text || text.length > limit) return null;
  return text;
}

/**
 * Provenance is validated before insertion so an invalid payload can never be
 * persisted. Source tags and the label are bounded here because the document
 * parser does not bound them.
 */
function buildSourceProvenance(input: {
  batchId: string;
  openApiVersion: "3.0" | "3.1";
  operationKey: string;
  documentFingerprint: string;
  definitionHash: string;
  tags: readonly string[];
  sourceLabel: string;
}): McpOpenApiSourceProvenance {
  const parsed = mcpOpenApiSourceProvenanceSchema.safeParse({
    version: MCP_OPENAPI_PROVENANCE_VERSION,
    batchId: input.batchId,
    openApiVersion: input.openApiVersion,
    operationKey: input.operationKey,
    documentFingerprint: input.documentFingerprint,
    definitionHash: input.definitionHash,
    tags: input.tags.filter((tag) => tag.length <= 256).slice(0, 64),
    sourceLabel: input.sourceLabel.slice(0, 512),
  } satisfies Record<string, unknown>);
  if (!parsed.success) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
      message: "Generated OpenAPI provenance failed validation.",
      status: 409,
    });
  }
  return parsed.data;
}
