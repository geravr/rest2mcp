export type AgentParamType = "string" | "number" | "boolean" | "json";

export type AgentMeta = {
  name: string;
  description?: string;
  type: AgentParamType;
  required: boolean;
};

export type ValueOrigin =
  | { origin: "fixed"; value: string }
  | { origin: "variable"; name: string; prefix: string }
  | ({ origin: "agent" } & AgentMeta);

export type SourceRow = { key: string } & ValueOrigin;

export type PathPart =
  | { kind: "text"; value: string }
  | { kind: "variable"; name: string }
  | ({ kind: "agent" } & AgentMeta);

export const PLACEHOLDER_PATTERN = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
const EXACT_PLACEHOLDER = /^\{\{([A-Za-z][A-Za-z0-9_]*)\}\}$/;
const PREFIXED_PLACEHOLDER = /^(.*)(\{\{([A-Za-z][A-Za-z0-9_]*)\}\})$/;
const BARE_JSON_PLACEHOLDER = /:\s*\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
const BARE_SENTINEL = "__BARE__:";

export function defaultAgentMeta(
  name: string,
  existing?: AgentMeta,
): AgentMeta {
  return {
    name,
    description: existing?.description,
    type: existing?.type ?? "string",
    required: existing?.required ?? true,
  };
}

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

export function toNameSet(names: Iterable<string>): Set<string> {
  return names instanceof Set ? names : new Set(names);
}

/**
 * Infer a UI origin from a stored template string. Mixed leftover syntax
 * stays Fixed so we never drop data.
 */
export function inferOrigin(
  value: string,
  variableNames: Iterable<string>,
  paramsByName?: ReadonlyMap<string, AgentMeta>,
): ValueOrigin {
  const variables = toNameSet(variableNames);
  const exact = value.match(EXACT_PLACEHOLDER);
  if (exact) {
    const name = exact[1];
    if (variables.has(name)) {
      return { origin: "variable", name, prefix: "" };
    }
    return {
      origin: "agent",
      ...defaultAgentMeta(name, paramsByName?.get(name)),
    };
  }

  const prefixed = value.match(PREFIXED_PLACEHOLDER);
  if (prefixed) {
    const prefix = prefixed[1];
    const name = prefixed[3];
    const extraPlaceholders = prefix.match(PLACEHOLDER_PATTERN);
    if (!extraPlaceholders && variables.has(name)) {
      return { origin: "variable", name, prefix };
    }
  }

  return { origin: "fixed", value };
}

/** Defaults never expose Agent; unknown placeholders stay visible as Fixed. */
export function inferDefaultOrigin(
  value: string,
  variableNames: Iterable<string>,
): Exclude<ValueOrigin, { origin: "agent" }> {
  const inferred = inferOrigin(value, variableNames);
  if (inferred.origin === "agent") {
    return { origin: "fixed", value };
  }
  return inferred;
}

export function compileOrigin(origin: ValueOrigin): string {
  if (origin.origin === "fixed") return origin.value;
  if (origin.origin === "variable") {
    return origin.name ? `${origin.prefix}{{${origin.name}}}` : origin.prefix;
  }
  return origin.name ? `{{${origin.name}}}` : "";
}

export function splitPath(
  path: string,
  variableNames: Iterable<string>,
  paramsByName?: ReadonlyMap<string, AgentMeta>,
): PathPart[] {
  const variables = toNameSet(variableNames);
  const parts: PathPart[] = [];
  let lastIndex = 0;
  for (const match of path.matchAll(PLACEHOLDER_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ kind: "text", value: path.slice(lastIndex, index) });
    }
    const name = match[1];
    if (variables.has(name)) {
      parts.push({ kind: "variable", name });
    } else {
      parts.push({
        kind: "agent",
        ...defaultAgentMeta(name, paramsByName?.get(name)),
      });
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < path.length || parts.length === 0) {
    parts.push({ kind: "text", value: path.slice(lastIndex) });
  }
  return parts;
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

export function inferMapRows(
  record: Record<string, string> | null | undefined,
  variableNames: Iterable<string>,
  paramsByName?: ReadonlyMap<string, AgentMeta>,
): SourceRow[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({
    key,
    ...inferOrigin(value, variableNames, paramsByName),
  }));
}

export function inferDefaultMapRows(
  record: Record<string, string> | null | undefined,
  variableNames: Iterable<string>,
): SourceRow[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({
    key,
    ...inferDefaultOrigin(value, variableNames),
  }));
}

export function compileMap(rows: SourceRow[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    record[key] = compileOrigin(row);
  }
  return record;
}

export function inferFormRows(
  body: string,
  variableNames: Iterable<string>,
  paramsByName?: ReadonlyMap<string, AgentMeta>,
): SourceRow[] {
  if (!body.trim()) return [];
  return [...new URLSearchParams(body)].map(([key, value]) => ({
    key,
    ...inferOrigin(value, variableNames, paramsByName),
  }));
}

function encodeFormSegment(value: string): string {
  return encodeURIComponent(value)
    .replace(/%7B%7B/g, "{{")
    .replace(/%7D%7D/g, "}}");
}

export function compileFormBody(rows: SourceRow[]): string {
  return rows
    .filter((row) => row.key.trim().length > 0)
    .map((row) => {
      const key = encodeURIComponent(row.key.trim());
      return `${key}=${encodeFormSegment(compileOrigin(row))}`;
    })
    .join("&");
}

function isPrimitiveJsonValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isFlatObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(isPrimitiveJsonValue);
}

function normalizeTemplateJson(body: string): string {
  return body.replace(BARE_JSON_PLACEHOLDER, (_, name: string) => {
    return `: "${BARE_SENTINEL}${name}"`;
  });
}

/** True when the stored JSON (including bare `{{name}}` values) is a flat object. */
export function isFlatJsonTemplate(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return true;
  try {
    const parsed: unknown = JSON.parse(normalizeTemplateJson(trimmed));
    return isFlatObject(parsed);
  } catch {
    return false;
  }
}

function compileJsonFragment(origin: ValueOrigin): string {
  if (origin.origin === "fixed") {
    const trimmed = origin.value.trim();
    if (trimmed.length > 0) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (
          parsed === null ||
          typeof parsed === "number" ||
          typeof parsed === "boolean"
        ) {
          return trimmed;
        }
      } catch {
        // treat as a string
      }
    }
    return JSON.stringify(origin.value);
  }
  if (origin.origin === "variable") {
    return JSON.stringify(compileOrigin(origin));
  }
  if (!origin.name) return JSON.stringify("");
  if (origin.type === "string") {
    return JSON.stringify(`{{${origin.name}}}`);
  }
  return `{{${origin.name}}}`;
}

export function compileStructuredJson(rows: SourceRow[]): string {
  const fields = rows
    .filter((row) => row.key.trim().length > 0)
    .map(
      (row) => `${JSON.stringify(row.key.trim())}:${compileJsonFragment(row)}`,
    );
  return `{${fields.join(",")}}`;
}

export function inferJsonRows(
  body: string,
  variableNames: Iterable<string>,
  paramsByName?: ReadonlyMap<string, AgentMeta>,
): SourceRow[] | null {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (!isFlatJsonTemplate(trimmed)) return null;
  try {
    const parsed = JSON.parse(normalizeTemplateJson(trimmed)) as Record<
      string,
      unknown
    >;
    return Object.entries(parsed).map(([key, value]) => {
      if (typeof value === "string" && value.startsWith(BARE_SENTINEL)) {
        const name = value.slice(BARE_SENTINEL.length);
        const meta = defaultAgentMeta(name, paramsByName?.get(name));
        return {
          key,
          origin: "agent" as const,
          ...meta,
          type: meta.type === "string" ? "number" : meta.type,
        };
      }
      if (typeof value === "string") {
        return { key, ...inferOrigin(value, variableNames, paramsByName) };
      }
      return {
        key,
        origin: "fixed" as const,
        value: JSON.stringify(value),
      };
    });
  } catch {
    return null;
  }
}

export function collectAgentParams(origins: ValueOrigin[]): AgentMeta[] {
  const seen = new Set<string>();
  const params: AgentMeta[] = [];
  for (const origin of origins) {
    if (origin.origin !== "agent" || !origin.name || seen.has(origin.name)) {
      continue;
    }
    seen.add(origin.name);
    params.push({
      name: origin.name,
      description: origin.description,
      type: origin.type,
      required: origin.required,
    });
  }
  return params;
}

export function paramsByName(
  params: AgentMeta[] | null | undefined,
): Map<string, AgentMeta> {
  const map = new Map<string, AgentMeta>();
  for (const param of params ?? []) {
    map.set(param.name, param);
  }
  return map;
}

export function detectPlaceholderNames(
  fields: Array<string | null | undefined>,
  variableNames: Iterable<string>,
): string[] {
  const variables = toNameSet(variableNames);
  const found = new Set<string>();
  for (const field of fields) {
    if (!field) continue;
    for (const match of field.matchAll(PLACEHOLDER_PATTERN)) {
      if (!variables.has(match[1])) found.add(match[1]);
    }
  }
  return [...found];
}

export function templateReferencesName(
  name: string,
  template: string | null | undefined,
): boolean {
  if (!template) return false;
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    if (match[1] === name) return true;
  }
  return false;
}

export function templatesReferenceName(
  name: string,
  templates: Array<string | null | undefined>,
): boolean {
  return templates.some((template) => templateReferencesName(name, template));
}

export function emptyFixedRow(): SourceRow {
  return { key: "", origin: "fixed", value: "" };
}

export function originsFromPath(parts: PathPart[]): ValueOrigin[] {
  const origins: ValueOrigin[] = [];
  for (const part of parts) {
    if (part.kind === "variable") {
      origins.push({ origin: "variable", name: part.name, prefix: "" });
    } else if (part.kind === "agent") {
      origins.push({
        origin: "agent",
        name: part.name,
        description: part.description,
        type: part.type,
        required: part.required,
      });
    }
  }
  return origins;
}
