/**
 * @file Pure agent-tool contract compiler. One immutable, deterministic
 * contract drives both MCP registration surfaces: advertised JSON Schema,
 * runtime input validation, behavior annotations, and the namespaced contract
 * metadata fingerprint. No database or network I/O happens here.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { APP_ERROR_CODES } from "./app-error.js";
import {
  type McpAgentInput,
  type McpBehaviorAnnotations,
  type McpCompileIssue,
  type McpCompiledPlan,
} from "./mcp-request-definition.js";
import { mcpToolOutputJsonSchema } from "./mcp-result.js";

/** Advertised agent-contract version. Bumped with the request-definition model. */
export const MCP_CONTRACT_VERSION = 2 as const;

/** Namespaced `_meta` key carrying contract version + fingerprint. */
export const MCP_CONTRACT_META_KEY = "io.rest2mcp/contract";

/** Namespaced property metadata key marking a value as sensitive. */
export const MCP_SENSITIVE_META_KEY = "io.rest2mcp/sensitive";

export const MCP_SUPPORTED_STRING_FORMATS = [
  "date",
  "date-time",
  "email",
  "uri",
  "uuid",
] as const;

export type McpSupportedStringFormat =
  (typeof MCP_SUPPORTED_STRING_FORMATS)[number];

const SUPPORTED_FORMAT_SET = new Set<string>(MCP_SUPPORTED_STRING_FORMATS);

export const MCP_CONTRACT_TITLE_MAX = 120;
export const MCP_CONTRACT_DESCRIPTION_MAX = 2000;
export const MCP_INPUT_DESCRIPTION_MAX = 2000;

export type McpToolContractMetadata = {
  [MCP_CONTRACT_META_KEY]: {
    version: typeof MCP_CONTRACT_VERSION;
    fingerprint: string;
  };
};

export type McpAgentToolContract = {
  name: string;
  title: string;
  description: string;
  method: string;
  contractVersion: typeof MCP_CONTRACT_VERSION;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations: Required<McpBehaviorAnnotations>;
  metadata: McpToolContractMetadata;
  fingerprint: string;
  /** Same semantics as the advertised schema; never persisted or fingerprinted. */
  inputValidator: z.ZodType<Record<string, unknown>>;
};

export type CompileAgentToolContractInput = {
  name: string;
  title?: string | null;
  description?: string | null;
  method: string;
  plan: McpCompiledPlan;
  baseIssues?: McpCompileIssue[];
};

export type CompileAgentToolContractResult = {
  ok: boolean;
  contract: McpAgentToolContract | null;
  issues: McpCompileIssue[];
};

/**
 * Agent-visible contract without the runtime-only Zod validator, for transport
 * serialization (Studio/Platform previews). The validator is never persisted,
 * fingerprinted, or sent to clients.
 */
export type McpSerializableToolContract = Omit<
  McpAgentToolContract,
  "inputValidator"
>;

export function toSerializableContract(
  contract: McpAgentToolContract,
): McpSerializableToolContract {
  const rest: Partial<McpAgentToolContract> = { ...contract };
  delete rest.inputValidator;
  return rest as McpSerializableToolContract;
}

const READ_METHODS = new Set(["GET", "HEAD"]);

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

export function canonicalContractJson(value: unknown): string {
  return stableStringify(value);
}

export function contractFingerprint(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(stableStringify(value))
    .digest("hex")}`;
}

function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31)) {
      return true;
    }
  }
  return false;
}

function pushIssue(
  issues: McpCompileIssue[],
  path: string,
  code: string,
  message: string,
  id?: string,
): void {
  issues.push({
    path,
    code,
    message,
    severity: "error",
    ...(id !== undefined ? { id } : {}),
  });
}

function isEnumValueCompatible(
  type: "string" | "number" | "boolean" | "integer" | "json" | "array",
  value: string | number | boolean,
): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "json":
      return true;
    case "array":
      return false;
  }
}

function literalFromValue(value: string | number | boolean): z.ZodTypeAny {
  return z.literal(value);
}

type PrimitiveFieldType = "string" | "number" | "boolean" | "integer" | "json";

type PrimitiveFieldConstraints = {
  format?: McpAgentInput["format"];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: Array<string | number | boolean>;
};

function buildPrimitiveZod(
  type: PrimitiveFieldType,
  constraints: PrimitiveFieldConstraints,
  issues: McpCompileIssue[],
  path: string,
  inputId: string | undefined,
  label: string,
): z.ZodTypeAny {
  const format = constraints.format;
  if (format !== undefined && !SUPPORTED_FORMAT_SET.has(format)) {
    pushIssue(
      issues,
      path,
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
      `${label} declares unsupported format "${format}".`,
      inputId,
    );
  }

  let field: z.ZodTypeAny;
  switch (type) {
    case "string": {
      let s: z.ZodTypeAny;
      if (format === "date") s = z.iso.date();
      else if (format === "date-time") s = z.iso.datetime();
      else if (format === "email") s = z.email();
      else if (format === "uri") s = z.url();
      else if (format === "uuid") s = z.uuid();
      else s = z.string();
      if (constraints.minLength !== undefined) {
        s = (s as z.ZodString).min(constraints.minLength);
      }
      if (constraints.maxLength !== undefined) {
        s = (s as z.ZodString).max(constraints.maxLength);
      }
      if (constraints.pattern) {
        try {
          s = (s as z.ZodString).regex(new RegExp(constraints.pattern));
        } catch {
          pushIssue(
            issues,
            path,
            APP_ERROR_CODES.MCP_COMPILE_INVALID,
            `${label} has an invalid regular expression.`,
            inputId,
          );
        }
      }
      field = s;
      break;
    }
    case "number": {
      let n = z.number();
      if (constraints.minimum !== undefined) n = n.min(constraints.minimum);
      if (constraints.maximum !== undefined) n = n.max(constraints.maximum);
      field = n;
      break;
    }
    case "integer": {
      let n = z.number().int();
      if (constraints.minimum !== undefined) n = n.min(constraints.minimum);
      if (constraints.maximum !== undefined) n = n.max(constraints.maximum);
      field = n;
      break;
    }
    case "boolean":
      field = z.boolean();
      break;
    default:
      field = z.unknown();
      break;
  }

  const numericBounds = type === "number" || type === "integer";
  if (
    numericBounds &&
    constraints.minimum !== undefined &&
    constraints.maximum !== undefined &&
    constraints.minimum > constraints.maximum
  ) {
    pushIssue(
      issues,
      path,
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
      `${label} has contradictory numeric bounds.`,
      inputId,
    );
  }
  if (
    type === "string" &&
    constraints.minLength !== undefined &&
    constraints.maxLength !== undefined &&
    constraints.minLength > constraints.maxLength
  ) {
    pushIssue(
      issues,
      path,
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
      `${label} has contradictory length bounds.`,
      inputId,
    );
  }

  if (constraints.enum && constraints.enum.length > 0) {
    const seen = new Set<string>();
    for (const value of constraints.enum) {
      const key = `${typeof value}:${String(value)}`;
      if (seen.has(key)) {
        pushIssue(
          issues,
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `${label} repeats an enum value.`,
          inputId,
        );
      }
      seen.add(key);
      if (!isEnumValueCompatible(type, value)) {
        pushIssue(
          issues,
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `${label} has an enum value incompatible with type "${type}".`,
          inputId,
        );
      }
      const numericValue = typeof value === "number" ? value : null;
      if (
        numericBounds &&
        numericValue !== null &&
        ((constraints.minimum !== undefined &&
          numericValue < constraints.minimum) ||
          (constraints.maximum !== undefined &&
            numericValue > constraints.maximum))
      ) {
        pushIssue(
          issues,
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `${label} has an enum value outside its bounds.`,
          inputId,
        );
      }
      if (
        type === "string" &&
        typeof value === "string" &&
        ((constraints.minLength !== undefined &&
          value.length < constraints.minLength) ||
          (constraints.maxLength !== undefined &&
            value.length > constraints.maxLength))
      ) {
        pushIssue(
          issues,
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `${label} has an enum value outside its length bounds.`,
          inputId,
        );
      }
    }
    const literals = constraints.enum.map(literalFromValue);
    field =
      literals.length === 1
        ? literals[0]!
        : z.union([literals[0]!, ...literals.slice(1)]);
  }

  return field;
}

/**
 * Builds one agent input as a Zod validator carrying description, format,
 * bounds, pattern, enum, examples, and `writeOnly`/sensitivity metadata.
 * The advertised JSON Schema is derived from this exact validator, so runtime
 * acceptance and the wire schema cannot drift.
 */
function buildAgentInput(
  input: McpAgentInput,
  issues: McpCompileIssue[],
): z.ZodTypeAny {
  const path = `agentInputs.${input.name}`;
  const label = `Input "${input.name}"`;
  let field: z.ZodTypeAny;

  if (input.type === "array") {
    const items = input.items;
    if (items === undefined) {
      pushIssue(
        issues,
        path,
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
        `${label} is an array without an item descriptor.`,
        input.id,
      );
      field = z.array(z.unknown());
    } else {
      const itemField = buildPrimitiveZod(
        items.type,
        items,
        issues,
        `${path}.items`,
        input.id,
        `Items of "${input.name}"`,
      );
      let arr = z.array(itemField);
      if (input.minItems !== undefined) arr = arr.min(input.minItems);
      if (input.maxItems !== undefined) arr = arr.max(input.maxItems);
      field = input.uniqueItems
        ? arr.refine(
            (values) =>
              new Set(values.map((value) => stableStringify(value))).size ===
              values.length,
            { message: `${label} requires unique items.` },
          )
        : arr;
      if (input.uniqueItems) {
        field = field.meta({ uniqueItems: true });
      }
    }
    if (
      input.minItems !== undefined &&
      input.maxItems !== undefined &&
      input.minItems > input.maxItems
    ) {
      pushIssue(
        issues,
        path,
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
        `${label} has contradictory item-count bounds.`,
        input.id,
      );
    }
  } else {
    field = buildPrimitiveZod(input.type, input, issues, path, input.id, label);
  }

  if (!input.description || input.description.trim().length === 0) {
    pushIssue(
      issues,
      path,
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
      `${label} must describe the value the agent supplies.`,
      input.id,
    );
  } else if (input.description.length > MCP_INPUT_DESCRIPTION_MAX) {
    pushIssue(
      issues,
      path,
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
      `${label} description is too long.`,
      input.id,
    );
  }

  let described = input.description ? field.describe(input.description) : field;

  if (input.sensitive) {
    // Sensitive values are write-only and never advertise an example/default.
    described = described.meta({
      writeOnly: true,
      [MCP_SENSITIVE_META_KEY]: true,
    });
  } else if (Array.isArray(input.examples) && input.examples.length > 0) {
    described = described.meta({ examples: input.examples });
  }

  return input.required ? described : described.optional();
}

export function buildAgentInputZodObject(
  agentInputs: McpAgentInput[],
  issues: McpCompileIssue[] = [],
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const seen = new Set<string>();
  for (const input of agentInputs) {
    if (seen.has(input.name)) {
      pushIssue(
        issues,
        `agentInputs.${input.name}`,
        APP_ERROR_CODES.MCP_VARIABLE_NAME_CONFLICT,
        `Input name "${input.name}" is declared more than once.`,
        input.id,
      );
      continue;
    }
    seen.add(input.name);
    shape[input.name] = buildAgentInput(input, issues);
  }
  return z.object(shape).strict() as unknown as z.ZodType<
    Record<string, unknown>
  >;
}

function validateAnnotationInvariants(
  method: string,
  annotations: Required<McpBehaviorAnnotations>,
  issues: McpCompileIssue[],
): void {
  const path = "annotations";
  const isRead = READ_METHODS.has(method);
  if (isRead) {
    if (annotations.readOnlyHint !== true) {
      pushIssue(
        issues,
        path,
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
        `${method} tools are read-only; readOnlyHint must be true.`,
      );
    }
    if (annotations.destructiveHint !== false) {
      pushIssue(
        issues,
        path,
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
        `${method} tools are not destructive; destructiveHint must be false.`,
      );
    }
    if (annotations.idempotentHint !== true) {
      pushIssue(
        issues,
        path,
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
        `${method} tools are idempotent; idempotentHint must be true.`,
      );
    }
  } else {
    if (annotations.readOnlyHint === true) {
      pushIssue(
        issues,
        path,
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
        `${method} tools mutate state and cannot be read-only.`,
      );
    }
    if (method === "DELETE" && annotations.destructiveHint !== true) {
      pushIssue(
        issues,
        path,
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
        "DELETE tools are destructive; destructiveHint must be true.",
      );
    }
  }
  if (annotations.openWorldHint !== true) {
    pushIssue(
      issues,
      path,
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
      "Tools that contact an upstream REST API must set openWorldHint true.",
    );
  }
}

function validateSemanticCopy(
  value: string | null | undefined,
  field: "title" | "description",
  max: number,
  issues: McpCompileIssue[],
): string {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) {
    pushIssue(
      issues,
      field,
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
      `An enabled tool requires an explicit ${field}.`,
    );
  } else if (trimmed.length > max) {
    pushIssue(
      issues,
      field,
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
      `The tool ${field} is too long.`,
    );
  } else if (hasControlCharacters(trimmed)) {
    pushIssue(
      issues,
      field,
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
      `The tool ${field} contains unsupported control characters.`,
    );
  }
  return trimmed;
}

/**
 * Compiles one immutable, fingerprinted agent contract from an already
 * validated compiled plan plus tool-level copy. Compilation never mutates
 * persisted data or resolves secret values.
 */
export function compileAgentToolContract(
  input: CompileAgentToolContractInput,
): CompileAgentToolContractResult {
  const issues: McpCompileIssue[] = [...(input.baseIssues ?? [])];
  const title = validateSemanticCopy(
    input.title,
    "title",
    MCP_CONTRACT_TITLE_MAX,
    issues,
  );
  const description = validateSemanticCopy(
    input.description,
    "description",
    MCP_CONTRACT_DESCRIPTION_MAX,
    issues,
  );

  const inputValidator = buildAgentInputZodObject(
    input.plan.agentInputs,
    issues,
  );
  const inputSchema = z.toJSONSchema(inputValidator, {
    io: "input",
    target: "draft-2020-12",
  }) as Record<string, unknown>;

  const annotations: Required<McpBehaviorAnnotations> = {
    readOnlyHint: input.plan.annotations.readOnlyHint ?? false,
    destructiveHint: input.plan.annotations.destructiveHint ?? false,
    idempotentHint: input.plan.annotations.idempotentHint ?? false,
    openWorldHint: input.plan.annotations.openWorldHint ?? false,
  };
  validateAnnotationInvariants(input.method, annotations, issues);

  const ok = issues.every((issue) => issue.severity !== "error");

  if (!ok) {
    return { ok: false, contract: null, issues };
  }

  const fingerprintPayload = {
    contractVersion: MCP_CONTRACT_VERSION,
    name: input.name,
    title,
    description,
    inputSchema,
    outputSchema: mcpToolOutputJsonSchema,
    annotations,
  };
  const fingerprint = contractFingerprint(fingerprintPayload);

  const contract: McpAgentToolContract = {
    name: input.name,
    title,
    description,
    method: input.method,
    contractVersion: MCP_CONTRACT_VERSION,
    inputSchema,
    outputSchema: mcpToolOutputJsonSchema as Record<string, unknown>,
    annotations,
    metadata: {
      [MCP_CONTRACT_META_KEY]: {
        version: MCP_CONTRACT_VERSION,
        fingerprint,
      },
    },
    fingerprint,
    inputValidator: inputValidator as unknown as z.ZodType<
      Record<string, unknown>
    >,
  };

  return { ok: true, contract, issues };
}
