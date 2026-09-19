export type AgentParamType = "string" | "number" | "boolean" | "json";

export type AgentInputFormat = "date" | "date-time" | "email" | "uri" | "uuid";

export const AGENT_INPUT_FORMATS: readonly AgentInputFormat[] = [
  "date",
  "date-time",
  "email",
  "uri",
  "uuid",
];

export type AgentMeta = {
  name: string;
  description?: string;
  type: AgentParamType;
  /** Original agent-input type, preserved for `integer` round trips. */
  inputType?: "string" | "number" | "boolean" | "integer" | "json";
  required: boolean;
  /** Never logged/previewed; masked as a password field in the playground. */
  sensitive?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  /** Advertised string format for `string` inputs. */
  format?: AgentInputFormat;
  enum?: Array<string | number | boolean>;
  examples?: unknown[];
  allowEmpty?: boolean;
};

export type ValueOrigin =
  | { origin: "fixed"; value: string }
  | {
      origin: "variable";
      name: string;
      prefix: string;
      suffix?: string;
      /** Stable server-value id, when loaded from a typed definition. */
      serverValueId?: string;
    }
  | ({ origin: "agent"; id?: string } & AgentMeta);

export type SourceRow = {
  key: string;
  nodeId?: string;
  /** Omit this entry when its bound agent input is absent. */
  omitWhenAbsent?: boolean;
  /** Declared JSON type for structured body rows. */
  jsonType?: "string" | "number" | "boolean" | "null" | "any";
} & ValueOrigin;

export type PathPart =
  | { kind: "text"; value: string; nodeId?: string }
  | {
      kind: "variable";
      name: string;
      prefix?: string;
      suffix?: string;
      serverValueId?: string;
      nodeId?: string;
    }
  | ({ kind: "agent"; id?: string; nodeId?: string } & AgentMeta);

export const PLACEHOLDER_PATTERN = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;

export function slugifyAgentName(key: string): string {
  const snake = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (!snake) return "param";
  if (!/^[a-z]/.test(snake)) return `p_${snake}`.slice(0, 100);
  return snake.slice(0, 100);
}

export function joinPath(parts: PathPart[]): string {
  return parts
    .map((part) =>
      part.kind === "text" ? part.value : part.name ? `{{${part.name}}}` : "",
    )
    .join("");
}

function mergePathText(left: string, right: string): string {
  if (left.endsWith("/") && right.startsWith("/")) {
    return left + right.slice(1);
  }
  return left + right;
}

export function compactPathParts(parts: PathPart[]): PathPart[] {
  const compacted: PathPart[] = [];
  for (const part of parts) {
    if (part.kind === "text") {
      const previous = compacted[compacted.length - 1];
      if (previous?.kind === "text") {
        compacted[compacted.length - 1] = {
          kind: "text",
          value: mergePathText(previous.value, part.value),
        };
      } else {
        compacted.push({ ...part });
      }
    } else {
      compacted.push(part);
    }
  }
  return compacted;
}

export function removePathPart(parts: PathPart[], index: number): PathPart[] {
  return compactPathParts(parts.filter((_, position) => position !== index));
}

export function emptyFixedRow(): SourceRow {
  return { key: "", origin: "fixed", value: "" };
}

export type AgentConstraints = Pick<
  AgentMeta,
  | "minimum"
  | "maximum"
  | "minLength"
  | "maxLength"
  | "pattern"
  | "enum"
  | "examples"
  | "allowEmpty"
>;

/** Comma-separated editor value for `enum`/`examples` lists (kept as strings). */
export function joinCommaList(
  values: Array<string | number | boolean> | unknown[] | undefined,
): string {
  if (!values || values.length === 0) return "";
  return values.map((value) => String(value)).join(", ");
}

export function parseCommaList(text: string): string[] | undefined {
  const items = text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}
