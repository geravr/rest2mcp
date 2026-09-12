import { join, relative } from "path";
import { readdir, readFile, writeFile, stat } from "fs/promises";

export const DEFAULT_SEARCH_PATTERN = "rest2mcp";

/** Paths relative to repo root that must never be modified by rename. */
export const EXCLUDE_FILE_PATHS = new Set(["LICENSE", "README.md"]);

/** Directory names skipped during the deep scan. */
export const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  ".cache",
  ".astro",
  "dist",
  ".windsurf",
  "openspec",
]);

/** Binary/unrelated file extensions to skip. */
export const EXCLUDE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".svg",
  ".pdf",
  ".zip",
  ".lock",
  "tsbuildinfo",
]);

export function isExcludedFile(relativePath: string): boolean {
  return EXCLUDE_FILE_PATHS.has(relativePath);
}

export function countMatches(content: string, searchPattern: string): number {
  if (searchPattern.length === 0) return 0;
  let count = 0;
  let index = content.indexOf(searchPattern);
  while (index !== -1) {
    count++;
    index = content.indexOf(searchPattern, index + searchPattern.length);
  }
  return count;
}

async function getFiles(
  dir: string,
  fileList: string[] = [],
): Promise<string[]> {
  const files = await readdir(dir);
  for (const file of files) {
    const filePath = join(dir, file);
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      if (EXCLUDE_DIRS.has(file)) continue;
      await getFiles(filePath, fileList);
    } else {
      const ext = file.substring(file.lastIndexOf("."));
      if (EXCLUDE_EXTENSIONS.has(ext) || EXCLUDE_EXTENSIONS.has(file)) continue;
      fileList.push(filePath);
    }
  }
  return fileList;
}

export async function collectRenameTargets(
  rootDir: string,
  searchPattern: string,
): Promise<Array<{ path: string; relativePath: string; matchCount: number }>> {
  const allFiles = await getFiles(rootDir);
  const targets: Array<{
    path: string;
    relativePath: string;
    matchCount: number;
  }> = [];

  for (const file of allFiles) {
    const relativePath = relative(rootDir, file);
    if (isExcludedFile(relativePath)) continue;

    try {
      const content = await readFile(file, "utf-8");
      const matchCount = countMatches(content, searchPattern);
      if (matchCount > 0) {
        targets.push({ path: file, relativePath, matchCount });
      }
    } catch {
      // Skip files that aren't readable text
    }
  }

  return targets;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("\n🚀 rest2mcp Renaming Utility");
  console.log(
    `This script finds occurrences of "${DEFAULT_SEARCH_PATTERN}" in the demo product layer and replaces them with your product name.\n`,
  );
  console.log(
    "Template layer files (LICENSE, README.md, openspec/) are excluded.\n",
  );

  const newName = prompt(
    "📝 Enter your new project name (e.g. Charro Garage):",
  );
  if (!newName || newName.trim() === "") {
    console.log("❌ Error: Project name cannot be empty. Aborting.");
    process.exit(1);
  }

  const trimmedNewName = newName.trim();
  const searchPattern = DEFAULT_SEARCH_PATTERN;

  console.log(
    `\n🔍 Scanning workspace for files containing "${searchPattern}"...`,
  );

  const rootDir = join(import.meta.dirname, "..");
  const targets = await collectRenameTargets(rootDir, searchPattern);

  if (targets.length === 0) {
    console.log(
      "✨ No occurrences found! The template is already renamed or clean.",
    );
    return;
  }

  const totalMatches = targets.reduce((sum, t) => sum + t.matchCount, 0);
  console.log(
    `\n📋 Found ${totalMatches} occurrence(s) in ${targets.length} file(s):`,
  );
  for (const target of targets) {
    console.log(`  - ${target.relativePath} (${target.matchCount})`);
  }

  if (dryRun) {
    console.log(
      `\n🔎 Dry run complete. No files were modified. Would replace "${searchPattern}" with "${trimmedNewName}".`,
    );
    return;
  }

  const confirm = prompt(
    `\n⚠️ Are you sure you want to replace "${searchPattern}" with "${trimmedNewName}" in these files? (y/n):`,
  );
  if (confirm?.toLowerCase() !== "y" && confirm?.toLowerCase() !== "yes") {
    console.log("❌ Rename cancelled by user.");
    process.exit(0);
  }

  console.log("\n⚡ Updating files...");
  let updatedCount = 0;

  for (const target of targets) {
    try {
      const content = await readFile(target.path, "utf-8");
      const updatedContent = content.replaceAll(searchPattern, trimmedNewName);
      await writeFile(target.path, updatedContent, "utf-8");
      updatedCount++;
    } catch (err) {
      console.error(`❌ Failed to write to file: ${target.path}`, err);
    }
  }

  console.log(
    `\n✅ Successfully renamed project to "${trimmedNewName}" in ${updatedCount} files! 🎉\n`,
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("❌ An unexpected error occurred:", err);
    process.exit(1);
  });
}
