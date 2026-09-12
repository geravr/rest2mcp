import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_PATTERN,
  EXCLUDE_DIRS,
  EXCLUDE_FILE_PATHS,
  collectRenameTargets,
  countMatches,
  isExcludedFile,
} from "./rename";

describe("rename utility", () => {
  it("uses rest2mcp as the default search pattern", () => {
    expect(DEFAULT_SEARCH_PATTERN).toBe("rest2mcp");
  });

  it("excludes template-layer files from rename", () => {
    expect(isExcludedFile("LICENSE")).toBe(true);
    expect(isExcludedFile("README.md")).toBe(true);
    expect(isExcludedFile("apps/app/index.html")).toBe(false);
  });

  it("excludes openspec from directory scan", () => {
    expect(EXCLUDE_DIRS.has("openspec")).toBe(true);
    expect(EXCLUDE_DIRS.has(".git")).toBe(true);
  });

  it("documents protected paths in the exclude set", () => {
    expect(EXCLUDE_FILE_PATHS.has("LICENSE")).toBe(true);
    expect(EXCLUDE_FILE_PATHS.has("README.md")).toBe(true);
  });

  it("counts non-overlapping matches", () => {
    expect(countMatches("rest2mcp and rest2mcp", "rest2mcp")).toBe(2);
    expect(countMatches("no matches here", "rest2mcp")).toBe(0);
  });

  it("excludes template-layer files from rename targets", async () => {
    const rootDir = resolve(import.meta.dirname, "..");
    const targets = await collectRenameTargets(rootDir, DEFAULT_SEARCH_PATTERN);
    const relativePaths = targets.map((target) => target.relativePath);

    expect(relativePaths).not.toContain("LICENSE");
    expect(relativePaths).not.toContain("README.md");
    expect(relativePaths.some((path) => path.startsWith("openspec/"))).toBe(
      false,
    );
    expect(relativePaths).toContain(".env.example");
    expect(relativePaths).toContain("apps/api/lib/env.ts");
  });
});
