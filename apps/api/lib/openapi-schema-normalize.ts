/**
 * @file Bounded, deterministic OpenAPI schema normalizer. Unwraps single-entry
 * `allOf`, merges conflict-safe object composition, and reports cycles, depth
 * limits, and incompatible branches without guessing. Does not fetch `$ref`s.
 */
import { MCP_OPENAPI_ISSUE_CODES, MCP_OPENAPI_LIMITS } from "@repo/core";
import type { McpOpenApiIssueCode } from "@repo/core";

const MAX_DEPTH = MCP_OPENAPI_LIMITS.maxRefDepth;

type JsonRecord = Record<string, unknown>;

export type NormalizeOpenApiSchemaSuccess = {
  ok: true;
  schema: JsonRecord;
};

export type NormalizeOpenApiSchemaFailure = {
  ok: false;
  code: McpOpenApiIssueCode;
  message: string;
};

export type NormalizeOpenApiSchemaResult =
  NormalizeOpenApiSchemaSuccess | NormalizeOpenApiSchemaFailure;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function schemasEquivalent(left: JsonRecord, right: JsonRecord): boolean {
  return stableStringify(left) === stableStringify(right);
}

function schemaTypeName(schema: JsonRecord): string | undefined {
  return typeof schema.type === "string" ? schema.type : undefined;
}

function isObjectShaped(schema: JsonRecord): boolean {
  const typeName = schemaTypeName(schema);
  if (typeName === "object") return true;
  if (typeName !== undefined) return false;
  return (
    isRecord(schema.properties) || schema.additionalProperties !== undefined
  );
}

function fail(
  code: McpOpenApiIssueCode,
  message: string,
): NormalizeOpenApiSchemaFailure {
  return { ok: false, code, message };
}

function mergeRequired(left: unknown, right: unknown): string[] {
  const values = new Set<string>();
  for (const source of [left, right]) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      if (typeof entry === "string") values.add(entry);
    }
  }
  return [...values];
}

function mergeNumericBound(
  left: number | undefined,
  right: number | undefined,
  pick: "max" | "min",
): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return pick === "max" ? Math.max(left, right) : Math.min(left, right);
}

function mergeCompatibleConstraints(
  left: JsonRecord,
  right: JsonRecord,
): JsonRecord | null {
  const merged: JsonRecord = { ...left, ...right };
  const minLength = mergeNumericBound(
    typeof left.minLength === "number" ? left.minLength : undefined,
    typeof right.minLength === "number" ? right.minLength : undefined,
    "max",
  );
  const maxLength = mergeNumericBound(
    typeof left.maxLength === "number" ? left.maxLength : undefined,
    typeof right.maxLength === "number" ? right.maxLength : undefined,
    "min",
  );
  if (
    minLength !== undefined &&
    maxLength !== undefined &&
    minLength > maxLength
  ) {
    return null;
  }
  const minimum = mergeNumericBound(
    typeof left.minimum === "number" ? left.minimum : undefined,
    typeof right.minimum === "number" ? right.minimum : undefined,
    "max",
  );
  const maximum = mergeNumericBound(
    typeof left.maximum === "number" ? left.maximum : undefined,
    typeof right.maximum === "number" ? right.maximum : undefined,
    "min",
  );
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    return null;
  }
  if (minLength !== undefined) merged.minLength = minLength;
  else delete merged.minLength;
  if (maxLength !== undefined) merged.maxLength = maxLength;
  else delete merged.maxLength;
  if (minimum !== undefined) merged.minimum = minimum;
  else delete merged.minimum;
  if (maximum !== undefined) merged.maximum = maximum;
  else delete merged.maximum;

  if (left.pattern !== undefined && right.pattern !== undefined) {
    if (left.pattern !== right.pattern) return null;
  }
  if (left.format !== undefined && right.format !== undefined) {
    if (left.format !== right.format) return null;
  }
  return merged;
}

function mergeObjectSchemas(
  left: JsonRecord,
  right: JsonRecord,
  ctx: { visiting: Set<JsonRecord>; depth: number },
): NormalizeOpenApiSchemaResult {
  if (!isObjectShaped(left) || !isObjectShaped(right)) {
    return fail(
      MCP_OPENAPI_ISSUE_CODES.COMPOSITION_CONFLICT,
      "allOf branches are not conflict-free object schemas.",
    );
  }
  if (
    left.additionalProperties !== undefined ||
    right.additionalProperties !== undefined
  ) {
    if (
      stableStringify(left.additionalProperties) !==
      stableStringify(right.additionalProperties)
    ) {
      return fail(
        MCP_OPENAPI_ISSUE_CODES.COMPOSITION_CONFLICT,
        'allOf branches declare incompatible "additionalProperties".',
      );
    }
  }

  const leftProperties = isRecord(left.properties) ? left.properties : {};
  const rightProperties = isRecord(right.properties) ? right.properties : {};
  const propertyNames = new Set([
    ...Object.keys(leftProperties),
    ...Object.keys(rightProperties),
  ]);
  const properties: JsonRecord = {};
  for (const name of propertyNames) {
    const leftChild = leftProperties[name];
    const rightChild = rightProperties[name];
    if (leftChild === undefined) {
      properties[name] = rightChild;
      continue;
    }
    if (rightChild === undefined) {
      properties[name] = leftChild;
      continue;
    }
    if (!isRecord(leftChild) || !isRecord(rightChild)) {
      return fail(
        MCP_OPENAPI_ISSUE_CODES.COMPOSITION_CONFLICT,
        `allOf branches assign incompatible schemas to "${name}".`,
      );
    }
    const normalizedLeft = normalizeOpenApiSchema(leftChild, ctx);
    if (!normalizedLeft.ok) return normalizedLeft;
    const normalizedRight = normalizeOpenApiSchema(rightChild, ctx);
    if (!normalizedRight.ok) return normalizedRight;
    if (schemasEquivalent(normalizedLeft.schema, normalizedRight.schema)) {
      properties[name] = normalizedLeft.schema;
      continue;
    }
    const mergedChild = mergeObjectSchemas(
      normalizedLeft.schema,
      normalizedRight.schema,
      ctx,
    );
    if (!mergedChild.ok) {
      return fail(
        MCP_OPENAPI_ISSUE_CODES.COMPOSITION_CONFLICT,
        `allOf branches assign incompatible schemas to "${name}".`,
      );
    }
    properties[name] = mergedChild.schema;
  }

  const constraints = mergeCompatibleConstraints(left, right);
  if (constraints === null) {
    return fail(
      MCP_OPENAPI_ISSUE_CODES.COMPOSITION_CONFLICT,
      "allOf branches declare contradictory constraints.",
    );
  }

  const merged: JsonRecord = {
    ...constraints,
    type: "object",
    properties,
  };
  const required = mergeRequired(left.required, right.required);
  if (required.length > 0) merged.required = required;
  else delete merged.required;
  delete merged.allOf;
  return { ok: true, schema: merged };
}

function unwrapSingleAllOf(
  schema: JsonRecord,
  inner: JsonRecord,
  ctx: { visiting: Set<JsonRecord>; depth: number },
): NormalizeOpenApiSchemaResult {
  const normalizedInner = normalizeOpenApiSchema(inner, ctx);
  if (!normalizedInner.ok) return normalizedInner;
  const siblings: JsonRecord = { ...schema };
  delete siblings.allOf;
  if (Object.keys(siblings).length === 0) {
    return { ok: true, schema: normalizedInner.schema };
  }
  if (isObjectShaped(normalizedInner.schema) && isObjectShaped(siblings)) {
    return mergeObjectSchemas(normalizedInner.schema, siblings, ctx);
  }
  if (schemaTypeName(normalizedInner.schema) && schemaTypeName(siblings)) {
    if (schemaTypeName(normalizedInner.schema) !== schemaTypeName(siblings)) {
      return fail(
        MCP_OPENAPI_ISSUE_CODES.COMPOSITION_CONFLICT,
        "allOf wrapper annotations conflict with the inner schema type.",
      );
    }
  }
  const constraints = mergeCompatibleConstraints(
    normalizedInner.schema,
    siblings,
  );
  if (constraints === null) {
    return fail(
      MCP_OPENAPI_ISSUE_CODES.COMPOSITION_CONFLICT,
      "allOf wrapper annotations conflict with the inner schema constraints.",
    );
  }
  delete constraints.allOf;
  return { ok: true, schema: constraints };
}

/**
 * Returns a composition-normalized copy of `schema`. The input object is never
 * mutated. `$ref` values are treated as unresolved and left for the mapper.
 */
export function normalizeOpenApiSchema(
  schema: JsonRecord,
  ctx: { visiting?: Set<JsonRecord>; depth?: number } = {},
): NormalizeOpenApiSchemaResult {
  const depth = ctx.depth ?? 0;
  if (depth > MAX_DEPTH) {
    return fail(
      MCP_OPENAPI_ISSUE_CODES.LIMIT_EXCEEDED,
      `Schema composition exceeded ${MAX_DEPTH} levels of nesting.`,
    );
  }
  const visiting = ctx.visiting ?? new Set<JsonRecord>();
  if (visiting.has(schema)) {
    return fail(
      MCP_OPENAPI_ISSUE_CODES.CYCLIC_REFERENCE,
      "Schema composition refers to itself.",
    );
  }
  visiting.add(schema);
  const nextCtx = { visiting, depth: depth + 1 };
  try {
    const allOf = schema.allOf;
    if (Array.isArray(allOf) && allOf.length > 0) {
      const branches: JsonRecord[] = [];
      for (const [index, branch] of allOf.entries()) {
        if (!isRecord(branch)) {
          return fail(
            MCP_OPENAPI_ISSUE_CODES.COMPOSITION_CONFLICT,
            `allOf[${index}] is not an object schema.`,
          );
        }
        const normalized = normalizeOpenApiSchema(branch, nextCtx);
        if (!normalized.ok) return normalized;
        branches.push(normalized.schema);
      }
      if (branches.length === 1) {
        const unwrapped = unwrapSingleAllOf(schema, branches[0]!, nextCtx);
        if (!unwrapped.ok) return unwrapped;
        return normalizeOpenApiSchema(unwrapped.schema, nextCtx);
      }
      let merged = branches[0]!;
      for (let index = 1; index < branches.length; index += 1) {
        const next = mergeObjectSchemas(merged, branches[index]!, nextCtx);
        if (!next.ok) return next;
        merged = next.schema;
      }
      const siblings: JsonRecord = { ...schema };
      delete siblings.allOf;
      if (Object.keys(siblings).length > 0) {
        const withSiblings = isObjectShaped(siblings)
          ? mergeObjectSchemas(merged, siblings, nextCtx)
          : unwrapSingleAllOf(
              { ...siblings, allOf: [merged] },
              merged,
              nextCtx,
            );
        if (!withSiblings.ok) return withSiblings;
        merged = withSiblings.schema;
      }
      return normalizeOpenApiSchema(merged, nextCtx);
    }

    const copy: JsonRecord = { ...schema };
    if (isRecord(copy.properties)) {
      const properties: JsonRecord = {};
      for (const [key, value] of Object.entries(copy.properties)) {
        if (!isRecord(value)) {
          properties[key] = value;
          continue;
        }
        const nested = normalizeOpenApiSchema(value, nextCtx);
        if (!nested.ok) return nested;
        properties[key] = nested.schema;
      }
      copy.properties = properties;
    }
    if (isRecord(copy.items)) {
      const nested = normalizeOpenApiSchema(copy.items, nextCtx);
      if (!nested.ok) return nested;
      copy.items = nested.schema;
    }
    return { ok: true, schema: copy };
  } finally {
    visiting.delete(schema);
  }
}

export function isLocallyResolvedUnion(
  schema: JsonRecord,
  keyword: "oneOf" | "anyOf",
): schema is JsonRecord & Record<"oneOf" | "anyOf", JsonRecord[]> {
  const branches = schema[keyword];
  if (!Array.isArray(branches) || branches.length === 0) return false;
  return branches.every(
    (branch) => isRecord(branch) && branch.$ref === undefined,
  );
}

export function unionHasForbiddenTransport(schema: JsonRecord): boolean {
  const branches = [
    ...(Array.isArray(schema.oneOf) ? schema.oneOf : []),
    ...(Array.isArray(schema.anyOf) ? schema.anyOf : []),
  ];
  for (const branch of branches) {
    if (!isRecord(branch)) return true;
    if (branch.$ref !== undefined) return true;
    const format = typeof branch.format === "string" ? branch.format : "";
    if (format === "binary" || format === "byte") return true;
    const contentMediaType =
      typeof branch.contentMediaType === "string"
        ? branch.contentMediaType
        : "";
    if (
      contentMediaType.includes("multipart") ||
      contentMediaType.includes("octet-stream")
    ) {
      return true;
    }
  }
  return false;
}
