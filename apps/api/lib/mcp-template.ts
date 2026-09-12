/**
 * @file Request template renderer: {{placeholder}} interpolation with
 * args-first-then-variables resolution and context-aware escaping.
 */
import { APP_ERROR_CODES, appError } from "./app-error.js";

export type TemplateContext =
  "path" | "query" | "header" | "json" | "form" | "raw";

export type TemplateVariable = {
  value: string;
  isSecret: boolean;
};

export type RenderScope = {
  args: Record<string, unknown>;
  /** Decrypted variables keyed by name. */
  variables: Record<string, TemplateVariable>;
  /** Secret values injected into the render, collected for log redaction. */
  secretsUsed: Set<string>;
};

const PLACEHOLDER_PATTERN = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
const QUOTED_PLACEHOLDER_PATTERN = /"\{\{([A-Za-z][A-Za-z0-9_]*)\}\}"/g;

export function extractPlaceholders(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    names.add(match[1]);
  }
  return [...names];
}

function toStringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function resolvePlaceholder(
  name: string,
  scope: RenderScope,
): { value: unknown; isSecret: boolean } {
  const arg = scope.args[name];
  if (arg !== undefined && arg !== null) {
    return { value: arg, isSecret: false };
  }
  const variable = scope.variables[name];
  if (variable) {
    if (variable.isSecret) scope.secretsUsed.add(variable.value);
    return variable;
  }
  throw appError({
    appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
    message: `Template placeholder "${name}" has no matching argument or server variable.`,
    status: 400,
  });
}

function escapeForContext(
  value: unknown,
  context: Exclude<TemplateContext, "json" | "query">,
): string {
  const text = toStringValue(value);
  switch (context) {
    case "path":
    case "form":
      return encodeURIComponent(text);
    case "header":
      return text.replace(/[\r\n]+/g, " ");
    case "raw":
      return text;
  }
}

/**
 * Query map values are pure values with no structural characters, so literal
 * segments and substitutions are both URL-encoded exactly once.
 */
function renderQueryTemplate(template: string, scope: RenderScope): string {
  return template
    .split(PLACEHOLDER_PATTERN)
    .map((part, index) => {
      if (index % 2 === 0) return encodeURIComponent(part);
      const resolved = resolvePlaceholder(part, scope);
      return encodeURIComponent(toStringValue(resolved.value));
    })
    .join("");
}

function isInsideJsonString(text: string, position: number): boolean {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < position; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') inString = !inString;
  }
  return inString;
}

function renderJsonTemplate(template: string, scope: RenderScope): string {
  const quoted = template.replace(
    QUOTED_PLACEHOLDER_PATTERN,
    (_, name: string) => {
      const resolved = resolvePlaceholder(name, scope);
      return JSON.stringify(toStringValue(resolved.value));
    },
  );
  return quoted.replace(
    PLACEHOLDER_PATTERN,
    (_, name: string, offset: number) => {
      const resolved = resolvePlaceholder(name, scope);
      if (isInsideJsonString(quoted, offset)) {
        // Embedded in a JSON string: escape as string content so quotes and
        // control characters in the value cannot break the document.
        return JSON.stringify(toStringValue(resolved.value)).slice(1, -1);
      }
      if (typeof resolved.value === "string") return resolved.value;
      return JSON.stringify(resolved.value);
    },
  );
}

export function renderTemplate(
  template: string,
  context: TemplateContext,
  scope: RenderScope,
): string {
  if (context === "json") {
    return renderJsonTemplate(template, scope);
  }
  if (context === "query") {
    return renderQueryTemplate(template, scope);
  }
  return template.replace(PLACEHOLDER_PATTERN, (_, name: string) => {
    const resolved = resolvePlaceholder(name, scope);
    return escapeForContext(resolved.value, context);
  });
}
