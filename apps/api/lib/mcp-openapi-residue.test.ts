import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API_ROOT = fileURLToPath(new URL("..", import.meta.url));

const LIB = (name: string) => join(API_ROOT, "lib", name);
const SERVICE = (name: string) => join(API_ROOT, "services", name);
const DB_SCHEMA = (name: string) =>
  fileURLToPath(new URL(`../../../db/schema/${name}`, import.meta.url));

const PUBLISHING_PATH = LIB("mcp-publishing.ts");
const REGISTRATION_PATH = LIB("mcp-registration.ts");
const EXECUTOR_PATH = SERVICE("mcp-executor-service.ts");
const PLATFORM_PATH = LIB("mcp-platform.ts");
const CALL_LOG_PATH = DB_SCHEMA("mcp-call-log.ts");
const REVISION_PATH = DB_SCHEMA("mcp-server-revision.ts");
const DOCUMENT_PATH = LIB("openapi-document.ts");
const MAPPER_PATH = LIB("openapi-mapper.ts");
const IMPORT_SERVICE_PATH = SERVICE("mcp-openapi-import-service.ts");
const STUDIO_SERVICE_PATH = SERVICE("mcp-studio-service.ts");

const IGNORED_DIRS = new Set(["dist", "node_modules", ".turbo"]);

function productionSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...productionSources(full));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".d.ts")) continue;
    files.push(full);
  }
  return files;
}

/** Extracts a function body by brace matching from its declaration. */
function functionBody(source: string, name: string): string {
  const declaration = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`,
  );
  const match = declaration.exec(source);
  if (!match) throw new Error(`Function ${name} was not found.`);
  const open = source.indexOf("{", match.index);
  if (open === -1) throw new Error(`Function ${name} has no body.`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`Function ${name} body was not terminated.`);
}

function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  if (from === -1) throw new Error(`Anchor "${start}" was not found.`);
  const to = source.indexOf(end, from);
  if (to === -1) throw new Error(`Anchor "${end}" was not found.`);
  return source.slice(from, to + end.length);
}

/** Every value assigned in a `field: value` object-literal position. */
function assignedValues(source: string, field: string): string[] {
  const pattern = new RegExp(`\\b${field}\\s*:\\s*([^,\\n}]+)`, "g");
  return [...source.matchAll(pattern)].map((match) => match[1].trim());
}

/** Every table named by an insert/update/delete call. */
function writtenTables(source: string): string[] {
  const pattern = /\.(?:insert|update|delete)\(\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

/** Every module specifier a file imports from. */
function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
}

describe("group and OpenAPI residue guards", () => {
  describe("group and provenance metadata never reach runtime or Platform", () => {
    it("keeps publication free of group metadata", () => {
      const publishing = readFileSync(PUBLISHING_PATH, "utf8");
      expect(publishing).not.toContain("groupId");
      expect(publishing).not.toContain("mcpToolGroup");
    });

    it("keeps registration metadata free of group and provenance metadata", () => {
      const registration = readFileSync(REGISTRATION_PATH, "utf8");
      expect(registration).not.toContain("groupId");
      expect(registration).not.toContain("sourceProvenance");
      expect(registration).not.toContain("mcpToolGroup");
    });

    it("empties group placement and provenance in the runtime tool projection", () => {
      const executor = readFileSync(EXECUTOR_PATH, "utf8");
      const projection = functionBody(executor, "revisionToolToMcpTool");
      expect(projection).toContain("groupId: null");
      expect(projection).toContain("sourceProvenance: null");
      expect(assignedValues(executor, "groupId")).toEqual(["null"]);
      expect(assignedValues(executor, "sourceProvenance")).toEqual(["null"]);
      expect(executor).not.toMatch(/groupId\s*[,}]/);
      expect(executor).not.toMatch(/sourceProvenance\s*[,}]/);
    });

    it("exposes no group field in any Platform input or output schema", () => {
      const platform = readFileSync(PLATFORM_PATH, "utf8");
      expect(platform).not.toContain("groupId: z.");
      expect(platform).not.toContain("groupId: string");
      expect(assignedValues(platform, "groupId")).toEqual([]);
      expect(assignedValues(platform, "sourceProvenance")).toEqual([]);
      // The redaction list must keep stripping both Studio-only columns.
      const redactionList = sliceBetween(
        platform,
        "const STUDIO_ONLY_TOOL_COLUMNS = [",
        "] as const;",
      );
      expect(redactionList).toContain('"groupId"');
      expect(redactionList).toContain('"sourceProvenance"');
    });

    it("keeps call logs free of group placement and import provenance", () => {
      const callLog = readFileSync(CALL_LOG_PATH, "utf8");
      expect(callLog).not.toContain("groupId");
      expect(callLog).not.toContain("sourceProvenance");
    });

    it("snapshots provenance but never group placement in revision rows", () => {
      const revision = readFileSync(REVISION_PATH, "utf8");
      expect(revision).toContain("sourceProvenance");
      expect(revision).not.toContain("groupId");
    });
  });

  describe("OpenAPI import cannot fetch external references or mutate authentication", () => {
    it("keeps the document reader free of network I/O and external references", () => {
      const document = readFileSync(DOCUMENT_PATH, "utf8");
      expect(document).not.toContain("fetch(");
      expect(document).not.toContain("node:http");
      expect(document).not.toContain("node:https");
      expect(document).not.toContain("node:dns");
      expect(document).not.toContain("undici");
      const networkImports = importSpecifiers(document).filter((specifier) =>
        /^(node:(http|https|dns|net)|undici|http|https|net|dns)/.test(
          specifier,
        ),
      );
      expect(networkImports).toEqual([]);
      expect(document).toContain('startsWith("#/")');
    });

    it("writes only tools and groups, and never server authentication state", () => {
      const service = readFileSync(IMPORT_SERVICE_PATH, "utf8");
      expect([...new Set(writtenTables(service))].sort()).toEqual([
        "mcpTool",
        "mcpToolGroup",
      ]);
      expect(service).not.toContain(".update(");
      expect(service).not.toContain(".delete(");
      expect(service).not.toContain("MCP_CREDENTIAL_SECRET");
    });

    it("allows only the import service to call the OpenAPI document fetcher", () => {
      const importService = readFileSync(IMPORT_SERVICE_PATH, "utf8");
      expect(importService).toContain("fetchOpenApiDocument(");
      for (const path of [DOCUMENT_PATH, MAPPER_PATH, STUDIO_SERVICE_PATH]) {
        expect(readFileSync(path, "utf8"), path).not.toContain(
          "fetchOpenApiDocument",
        );
      }

      const definition = relative(API_ROOT, LIB("openapi-fetch.ts"));
      const caller = relative(API_ROOT, IMPORT_SERVICE_PATH);
      const offenders = productionSources(API_ROOT)
        .filter((file) =>
          readFileSync(file, "utf8").includes("fetchOpenApiDocument"),
        )
        .map((file) => relative(API_ROOT, file))
        .filter((file) => file !== definition && file !== caller);
      expect(offenders).toEqual([]);
    });

    it("wires credential redaction into the OpenAPI mapper", () => {
      const mapper = readFileSync(MAPPER_PATH, "utf8");
      expect(mapper).toContain('from "./openapi-redact.js"');
    });
  });

  describe("imported tools cannot arrive callable", () => {
    it("inserts imported tools disabled with mutation permission off", () => {
      const service = readFileSync(IMPORT_SERVICE_PATH, "utf8");
      const payload = sliceBetween(
        service,
        ".insert(mcpTool)",
        ".returning({ id: mcpTool.id",
      );
      expect(payload).toContain("enabled: false");
      expect(payload).toContain("allowMutation: false");
    });

    it("never enables a tool or grants mutation permission anywhere", () => {
      const service = readFileSync(IMPORT_SERVICE_PATH, "utf8");
      expect(service).not.toMatch(/enabled:\s*true/);
      expect(service).not.toMatch(/allowMutation:\s*true/);
    });
  });
});
