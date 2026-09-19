/**
 * @file Owner-scoped Studio tool groups.
 *
 * Groups are a bounded presentation projection over the mutable draft: they
 * never enter publication candidates, immutable revisions, or runtime
 * execution. Every write runs through `withOwnedServerWrite` with
 * `draftMutation: false`, so a group change bumps `configRevision` exactly once
 * and leaves the publishable draft revision untouched.
 */
import { MCP_TOOL_GROUP_LIMITS } from "@repo/core";
import { mcpServer, mcpTool, mcpToolGroup, type McpToolGroup } from "@repo/db";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { APP_ERROR_CODES, appError } from "../lib/app-error.js";
import {
  isUniqueViolation,
  withOwnedServerWrite,
} from "./mcp-server-command.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export type McpToolGroupSummary = {
  id: string;
  name: string;
  normalizedName: string;
  toolCount: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Case-folds and collapses internal whitespace; the single source of truth for
 * `normalizedName`.
 */
export function normalizeToolGroupName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Validates a display name and returns it trimmed. */
export function validateToolGroupName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "Group name is required.",
      status: 400,
    });
  }
  if (name.length > MCP_TOOL_GROUP_LIMITS.name) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: `Group name cannot exceed ${MCP_TOOL_GROUP_LIMITS.name} characters.`,
      status: 400,
    });
  }
  return name;
}

async function requireOwnedServer(db: DB, userId: string, serverId: string) {
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

/** The owning server predicate is mandatory: a foreign group is concealed. */
async function requireOwnedGroup(
  db: DB,
  serverId: string,
  groupId: string,
): Promise<McpToolGroup> {
  const [group] = await db
    .select()
    .from(mcpToolGroup)
    .where(
      and(eq(mcpToolGroup.id, groupId), eq(mcpToolGroup.serverId, serverId)),
    )
    .limit(1);

  if (!group) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TOOL_GROUP_NOT_FOUND,
      message: "MCP tool group not found.",
      status: 404,
      details: { serverId },
    });
  }
  return group;
}

/**
 * Translates a normalized-name uniqueness violation into a stable conflict
 * without leaking SQL. The database constraint is the authority; no pre-check
 * can race it.
 */
function rethrowGroupNameConflict(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TOOL_GROUP_NAME_CONFLICT,
      message: "A group with this name already exists on the server.",
      status: 409,
    });
  }
  throw error;
}

/** Runs under the locked server row, so concurrent creates cannot exceed the cap. */
async function assertGroupCapacity(db: DB, serverId: string): Promise<void> {
  const [row] = await db
    .select({ count: count() })
    .from(mcpToolGroup)
    .where(eq(mcpToolGroup.serverId, serverId));
  const observed = row?.count ?? 0;
  if (observed >= MCP_TOOL_GROUP_LIMITS.maxGroupsPerServer) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TOOL_GROUP_LIMIT_REACHED,
      message: `A server cannot have more than ${MCP_TOOL_GROUP_LIMITS.maxGroupsPerServer} tool groups.`,
      status: 400,
      details: {
        serverId,
        limit: MCP_TOOL_GROUP_LIMITS.maxGroupsPerServer,
        observed,
      },
    });
  }
}

/**
 * Bounded group list with counts. The cap of 50 groups per server makes this an
 * explicitly tiny bounded list, so it is deliberately unpaginated.
 */
export async function listToolGroups(
  db: DB,
  userId: string,
  serverId: string,
): Promise<McpToolGroupSummary[]> {
  await requireOwnedServer(db, userId, serverId);
  const rows = await db
    .select({
      id: mcpToolGroup.id,
      name: mcpToolGroup.name,
      normalizedName: mcpToolGroup.normalizedName,
      toolCount: count(mcpTool.id),
      createdAt: mcpToolGroup.createdAt,
      updatedAt: mcpToolGroup.updatedAt,
    })
    .from(mcpToolGroup)
    .leftJoin(mcpTool, eq(mcpTool.groupId, mcpToolGroup.id))
    .where(eq(mcpToolGroup.serverId, serverId))
    .groupBy(mcpToolGroup.id)
    .orderBy(asc(mcpToolGroup.normalizedName), asc(mcpToolGroup.id));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    normalizedName: row.normalizedName,
    toolCount: row.toolCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function createToolGroup(
  db: DB,
  userId: string,
  serverId: string,
  input: { expectedRevision: number; name: string },
): Promise<{ group: McpToolGroup; revision: number; draftRevision: number }> {
  const name = validateToolGroupName(input.name);
  const normalizedName = normalizeToolGroupName(name);

  const { result, revision, draftRevision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision: input.expectedRevision },
    async (ctx) => {
      await assertGroupCapacity(ctx.tx, serverId);
      try {
        const [created] = await ctx.tx
          .insert(mcpToolGroup)
          .values({ serverId, name, normalizedName })
          .returning();
        return created;
      } catch (error) {
        rethrowGroupNameConflict(error);
      }
    },
    { draftMutation: false },
  );

  return { group: result, revision, draftRevision };
}

export async function renameToolGroup(
  db: DB,
  userId: string,
  serverId: string,
  input: { expectedRevision: number; groupId: string; name: string },
): Promise<{ group: McpToolGroup; revision: number; draftRevision: number }> {
  const name = validateToolGroupName(input.name);
  const normalizedName = normalizeToolGroupName(name);

  const { result, revision, draftRevision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision: input.expectedRevision },
    async (ctx) => {
      const group = await requireOwnedGroup(ctx.tx, serverId, input.groupId);
      try {
        const [updated] = await ctx.tx
          .update(mcpToolGroup)
          .set({ name, normalizedName })
          .where(
            and(
              eq(mcpToolGroup.id, group.id),
              eq(mcpToolGroup.serverId, serverId),
            ),
          )
          .returning();
        return updated;
      } catch (error) {
        rethrowGroupNameConflict(error);
      }
    },
    { draftMutation: false },
  );

  return { group: result, revision, draftRevision };
}

/**
 * Deletes only the group row after ungrouping its members. Member tools are
 * never deleted, disabled, renamed, or recompiled.
 */
export async function deleteToolGroup(
  db: DB,
  userId: string,
  serverId: string,
  input: { expectedRevision: number; groupId: string },
): Promise<{
  groupId: string;
  ungroupedToolCount: number;
  revision: number;
  draftRevision: number;
}> {
  const { result, revision, draftRevision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision: input.expectedRevision },
    async (ctx) => {
      const group = await requireOwnedGroup(ctx.tx, serverId, input.groupId);
      const ungrouped = await ctx.tx
        .update(mcpTool)
        .set({ groupId: null })
        .where(
          and(eq(mcpTool.serverId, serverId), eq(mcpTool.groupId, group.id)),
        )
        .returning({ id: mcpTool.id });
      await ctx.tx
        .delete(mcpToolGroup)
        .where(
          and(
            eq(mcpToolGroup.id, group.id),
            eq(mcpToolGroup.serverId, serverId),
          ),
        );
      return { groupId: group.id, ungroupedToolCount: ungrouped.length };
    },
    { draftMutation: false },
  );

  return { ...result, revision, draftRevision };
}

/**
 * Moves tools between groups (or out of every group with `groupId: null`).
 * Only the presentation-only `groupId` column changes.
 */
export async function assignToolsToGroup(
  db: DB,
  userId: string,
  serverId: string,
  input: {
    expectedRevision: number;
    toolIds: string[];
    groupId: string | null;
  },
): Promise<{
  groupId: string | null;
  toolIds: string[];
  revision: number;
  draftRevision: number;
}> {
  const toolIds = [...new Set(input.toolIds)];
  if (toolIds.length === 0) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "Select at least one tool.",
      status: 400,
    });
  }

  const { result, revision, draftRevision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision: input.expectedRevision },
    async (ctx) => {
      if (input.groupId !== null) {
        await requireOwnedGroup(ctx.tx, serverId, input.groupId);
      }
      const existing = await ctx.tx
        .select({ id: mcpTool.id })
        .from(mcpTool)
        .where(
          and(eq(mcpTool.serverId, serverId), inArray(mcpTool.id, toolIds)),
        );
      if (existing.length !== toolIds.length) {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
          message: "One or more MCP tools were not found on the server.",
          status: 404,
          details: { serverId },
        });
      }
      await ctx.tx
        .update(mcpTool)
        .set({ groupId: input.groupId })
        .where(
          and(eq(mcpTool.serverId, serverId), inArray(mcpTool.id, toolIds)),
        );
      return { groupId: input.groupId, toolIds };
    },
    { draftMutation: false },
  );

  return { ...result, revision, draftRevision };
}
