/**
 * @file Pure client-side helpers for the Studio OpenAPI import dialog.
 *
 * Everything the owner is shown before confirming lives here so it can be
 * tested without a DOM: local file guidance, preview filtering and ordering,
 * per-operation diagnostic codes, name validation, group planning, and
 * capacity projection. These rules mirror the API, which stays authoritative
 * and revalidates the whole submission on confirmation.
 */
import {
  isMcpOpenApiIssueCode,
  MCP_OPENAPI_LIMITS,
  type McpOpenApiIssueCode,
} from "@repo/core";

/** Mirrors the API's MCP tool name rule for owner-supplied name overrides. */
export const OPENAPI_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
export const OPENAPI_TOOL_NAME_MAX_LENGTH = 80;

export type OpenApiSourceMode = "file" | "paste" | "url";

export type OpenApiFileReadResult =
  | { ok: true; name: string; content: string }
  | { ok: false; reason: "kind" | "tooLarge" | "read" };

/** Local JSON guidance: the file is never uploaded, only read in the browser. */
export function isJsonDocumentFile(file: {
  name: string;
  type: string;
}): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return (
    name.endsWith(".json") ||
    type === "application/json" ||
    type === "text/json"
  );
}

/**
 * Reads a selected file locally. Size and kind are checked before reading so an
 * oversized or non-JSON file never reaches the preview request.
 */
export async function readOpenApiDocumentFile(
  file: Pick<File, "name" | "type" | "size" | "text">,
): Promise<OpenApiFileReadResult> {
  if (!isJsonDocumentFile(file)) {
    return { ok: false, reason: "kind" };
  }
  if (file.size > MCP_OPENAPI_LIMITS.maxDocumentBytes) {
    return { ok: false, reason: "tooLarge" };
  }
  try {
    const content = await file.text();
    return { ok: true, name: file.name, content };
  } catch {
    return { ok: false, reason: "read" };
  }
}

/** The API retrieves documents over public HTTPS only. */
export function isHttpsDocumentUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith("https://")) return false;
  return trimmed.length > "https://".length;
}

type SearchableOperation = {
  path: string;
  method: string;
  operationId?: string;
  title?: string;
  suggestedName: string;
  tags: readonly string[];
};

/** Case-insensitive preview filter; the preview is already fully fetched. */
export function filterOpenApiOperations<T extends SearchableOperation>(
  operations: readonly T[],
  search: string,
): T[] {
  const needle = search.trim().toLowerCase();
  if (needle.length === 0) return [...operations];
  return operations.filter((operation) => {
    const haystack = [
      operation.path,
      operation.method,
      operation.operationId ?? "",
      operation.title ?? "",
      operation.suggestedName,
      ...operation.tags,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export type OpenApiOperationGroup<T> = {
  /** First tag of the group's operations, or null for untagged operations. */
  tag: string | null;
  operations: T[];
};

function compareOperations(
  left: { path: string; method: string },
  right: { path: string; method: string },
): number {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  if (left.method !== right.method) return left.method < right.method ? -1 : 1;
  return 0;
}

/** Deterministic grouping by first tag: tagged groups sorted, untagged last. */
export function groupOpenApiOperations<
  T extends { path: string; method: string; tags: readonly string[] },
>(operations: readonly T[]): OpenApiOperationGroup<T>[] {
  const groups = new Map<string, OpenApiOperationGroup<T>>();
  for (const operation of operations) {
    const tag = operation.tags[0]?.trim() ?? "";
    const group = groups.get(tag) ?? {
      tag: tag.length > 0 ? tag : null,
      operations: [],
    };
    group.operations.push(operation);
    groups.set(tag, group);
  }
  const ordered = [...groups.values()].sort((left, right) => {
    if (left.tag === null) return 1;
    if (right.tag === null) return -1;
    return left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0;
  });
  for (const group of ordered) {
    group.operations.sort(compareOperations);
  }
  return ordered;
}

export type OpenApiIssueLike = { code: string; severity: "error" | "warning" };

/**
 * Pairs repeated entries with stable React keys derived from their own content.
 * Diagnostics have no id of their own and the same code can repeat at different
 * locations, so an occurrence suffix keeps keys unique without using indexes.
 */
export function withOpenApiKeys<T>(
  entries: readonly T[],
  identify: (entry: T) => string,
): Array<{ key: string; value: T }> {
  const seen = new Map<string, number>();
  return entries.map((value) => {
    const base = identify(value);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { key: occurrence === 0 ? base : `${base}#${occurrence}`, value };
  });
}

/** Blockers are exactly the error-severity issues of one operation. */
export function splitOpenApiIssues<T extends OpenApiIssueLike>(
  issues: readonly T[],
): { blockers: T[]; warnings: T[] } {
  return {
    blockers: issues.filter((issue) => issue.severity === "error"),
    warnings: issues.filter((issue) => issue.severity === "warning"),
  };
}

/**
 * Resolves the localized sentence for one issue code against the caller's
 * locale module. The copy never lives here: an unknown code falls back to the
 * caller's own fallback string.
 */
export function resolveOpenApiIssueDescription(
  descriptions: Readonly<Record<McpOpenApiIssueCode, string>>,
  code: string,
  fallback: string,
): string {
  return isMcpOpenApiIssueCode(code) ? descriptions[code] : fallback;
}

/** Scheme name, type, and placement only: credential values never appear. */
export function describeOpenApiSecurityRequirement(requirement: {
  name: string;
  type: string;
  in?: string;
  scheme?: string;
}): string {
  const placement = requirement.in ?? requirement.scheme;
  return placement === undefined
    ? `${requirement.name} (${requirement.type})`
    : `${requirement.name} (${requirement.type}, ${placement})`;
}

export type OpenApiNameIssue = "invalid" | "duplicate" | "conflict" | null;

/**
 * Client mirror of the API's name rules: shape, uniqueness inside the
 * selection, and collision with a tool that already exists on the server.
 */
export function findOpenApiNameIssue(input: {
  name: string;
  otherSelectedNames: readonly string[];
  existingToolNames: readonly string[];
}): OpenApiNameIssue {
  const name = input.name.trim();
  if (
    name.length === 0 ||
    name.length > OPENAPI_TOOL_NAME_MAX_LENGTH ||
    !OPENAPI_TOOL_NAME_PATTERN.test(name)
  ) {
    return "invalid";
  }
  if (input.otherSelectedNames.includes(name)) return "duplicate";
  if (input.existingToolNames.includes(name)) return "conflict";
  return null;
}

export type OpenApiSelectionDraft = {
  operationKey: string;
  suggestedName: string;
  name: string;
};

/** Sends a name only when the owner changed it from the suggestion. */
export function buildOpenApiSelection(
  drafts: readonly OpenApiSelectionDraft[],
): Array<{ operationKey: string; name?: string }> {
  return drafts.map((draft) => {
    const name = draft.name.trim();
    return name.length > 0 && name !== draft.suggestedName
      ? { operationKey: draft.operationKey, name }
      : { operationKey: draft.operationKey };
  });
}

/** Same normalization the API applies to group names. */
export function normalizeOpenApiGroupName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export type OpenApiGroupSuggestion = {
  tag: string;
  normalizedName: string;
  existingGroupId?: string;
  willCreate: boolean;
};

export type OpenApiFirstTagPlan = {
  /** Groups first-tag mapping would reuse, in first-seen tag order. */
  reuse: Array<{ tag: string; name: string; groupId: string }>;
  /** Groups first-tag mapping would create; one per missing first tag. */
  create: Array<{ tag: string; name: string }>;
  /** Selected operations whose first tag is missing; they stay ungrouped. */
  ungrouped: number;
  creationCount: number;
};

/**
 * First-tag planning for the current selection. Mirrors the API's precedence:
 * reuse a normalized existing group, otherwise create one group per missing
 * first tag, and leave untagged operations ungrouped.
 */
export function planFirstTagGroups(input: {
  selectedOperations: readonly { tags: readonly string[] }[];
  suggestedGroups: readonly OpenApiGroupSuggestion[];
  existingGroups?: readonly { id: string; name: string }[];
}): OpenApiFirstTagPlan {
  const existingByNormalizedName = new Map(
    (input.existingGroups ?? []).map((group) => [
      normalizeOpenApiGroupName(group.name),
      group,
    ]),
  );
  const suggestionByNormalizedName = new Map(
    input.suggestedGroups.map((suggestion) => [
      suggestion.normalizedName,
      suggestion,
    ]),
  );
  const reuse: OpenApiFirstTagPlan["reuse"] = [];
  const create: OpenApiFirstTagPlan["create"] = [];
  let ungrouped = 0;
  const seen = new Set<string>();

  for (const operation of input.selectedOperations) {
    const tag = operation.tags[0];
    const normalized = tag === undefined ? "" : normalizeOpenApiGroupName(tag);
    if (normalized.length === 0) {
      ungrouped += 1;
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const existing = existingByNormalizedName.get(normalized);
    const suggestion = suggestionByNormalizedName.get(normalized);
    const groupId = existing?.id ?? suggestion?.existingGroupId;
    if (groupId !== undefined) {
      reuse.push({
        tag,
        name: existing?.name ?? suggestion?.tag ?? tag,
        groupId,
      });
      continue;
    }
    create.push({ tag, name: suggestion?.tag ?? tag.trim() });
  }

  return { reuse, create, ungrouped, creationCount: create.length };
}

export type OpenApiCapacityProjection = {
  toolLimit: number;
  currentTools: number;
  selectedCount: number;
  remainingTools: number;
  toolsExceeded: boolean;
  groupLimit: number;
  currentGroups: number;
  plannedGroups: number;
  remainingGroups: number;
  groupsExceeded: boolean;
};

export function projectOpenApiCapacity(input: {
  capacity: {
    toolLimit: number;
    currentTools: number;
    groupLimit: number;
    currentGroups: number;
  };
  selectedCount: number;
  plannedGroups: number;
}): OpenApiCapacityProjection {
  const remainingTools = Math.max(
    input.capacity.toolLimit - input.capacity.currentTools,
    0,
  );
  const remainingGroups = Math.max(
    input.capacity.groupLimit - input.capacity.currentGroups,
    0,
  );
  return {
    toolLimit: input.capacity.toolLimit,
    currentTools: input.capacity.currentTools,
    selectedCount: input.selectedCount,
    remainingTools,
    toolsExceeded: input.selectedCount > remainingTools,
    groupLimit: input.capacity.groupLimit,
    currentGroups: input.capacity.currentGroups,
    plannedGroups: input.plannedGroups,
    remainingGroups,
    groupsExceeded: input.plannedGroups > remainingGroups,
  };
}

/** Selectable operation keys that fit in remaining server tool capacity. */
export function selectOpenApiKeysUpToCapacity(
  selectableKeys: readonly string[],
  remainingCapacity: number,
): string[] {
  return selectableKeys.slice(0, Math.max(remainingCapacity, 0));
}

/**
 * Adds `operationKey` when capacity remains. Deselection always succeeds.
 * Existing selected keys that no longer fit are not silently dropped here so
 * the owner can deselect and reselect.
 */
export function nextOpenApiSelection(
  selectedKeys: readonly string[],
  operationKey: string,
  selected: boolean,
  remainingCapacity: number,
): string[] {
  if (!selected) {
    return selectedKeys.filter((key) => key !== operationKey);
  }
  if (selectedKeys.includes(operationKey)) return [...selectedKeys];
  if (selectedKeys.length >= remainingCapacity) return [...selectedKeys];
  return [...selectedKeys, operationKey];
}

export type OpenApiRequestSummary = {
  pathParameters: number;
  queryParameters: number;
  headerParameters: number;
  body: "none" | "json" | "form" | "raw";
};

/**
 * A path segment is a path parameter only when it binds an agent input; literal
 * segments carry no parameter and must never inflate the count.
 */
function countPathParameters(segments: unknown): number {
  if (!Array.isArray(segments)) return 0;
  return segments.filter((segment) => {
    if (segment === null || typeof segment !== "object") return false;
    const binding = (segment as Record<string, unknown>).value;
    if (binding === null || typeof binding !== "object") return false;
    return (binding as Record<string, unknown>).kind === "agentInput";
  }).length;
}

/** Compact structural summary of a previewed canonical request definition. */
export function summarizeOpenApiRequest(
  requestDefinition: unknown,
): OpenApiRequestSummary | null {
  if (requestDefinition === null || typeof requestDefinition !== "object") {
    return null;
  }
  const record = requestDefinition as Record<string, unknown>;
  const body = record.body;
  if (body === null || typeof body !== "object") return null;
  const bodyType = (body as { bodyType?: unknown }).bodyType;
  if (
    bodyType !== "none" &&
    bodyType !== "json" &&
    bodyType !== "form" &&
    bodyType !== "raw"
  ) {
    return null;
  }
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  return {
    pathParameters: countPathParameters(record.pathSegments),
    queryParameters: count(record.query),
    headerParameters: count(record.headers),
    body: bodyType,
  };
}

/** Whether the summary carries anything the owner can see. */
export function hasOpenApiRequestSummary(
  summary: OpenApiRequestSummary | null,
): summary is OpenApiRequestSummary {
  return (
    summary !== null &&
    (summary.body !== "none" ||
      summary.pathParameters > 0 ||
      summary.queryParameters > 0 ||
      summary.headerParameters > 0)
  );
}
