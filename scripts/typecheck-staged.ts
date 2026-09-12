import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const cwd = process.cwd();
const supportedExtensions = new Set([".ts", ".tsx"]);

function isTypecheckableFile(filePath: string): boolean {
  const ext = path.extname(filePath);
  return supportedExtensions.has(ext);
}

function toAbsolute(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

function findNearestTsconfig(startPath: string): string | null {
  let currentDir = fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);

  while (true) {
    const tsconfigPath = path.join(currentDir, "tsconfig.json");
    if (fs.existsSync(tsconfigPath)) {
      return tsconfigPath;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function readProjectConfig(tsconfigPath: string): {
  fileNames: string[];
  options: ts.CompilerOptions;
  projectReferences?: readonly ts.ProjectReference[];
} {
  const readResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (readResult.error) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext([readResult.error], {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => cwd,
        getNewLine: () => ts.sys.newLine,
      }),
    );
  }

  const parsed = ts.parseJsonConfigFileContent(
    readResult.config,
    ts.sys,
    path.dirname(tsconfigPath),
    {
      noEmit: true,
      pretty: true,
    },
    tsconfigPath,
  );

  if (parsed.errors.length > 0) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(parsed.errors, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => cwd,
        getNewLine: () => ts.sys.newLine,
      }),
    );
  }

  return {
    fileNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
  };
}

function isDiagnosticRelevantToStagedFiles(
  diagnostic: ts.Diagnostic,
  stagedFiles: Set<string>,
): boolean {
  if (!diagnostic.file) {
    return true;
  }

  const absolutePath = path.resolve(diagnostic.file.fileName);
  return stagedFiles.has(absolutePath);
}

function main(): number {
  const stagedArgs = process.argv.slice(2);
  const files = stagedArgs
    .map(toAbsolute)
    .filter((filePath) => fs.existsSync(filePath))
    .filter(isTypecheckableFile);

  if (files.length === 0) {
    return 0;
  }

  const filesByTsconfig = new Map<string, Set<string>>();

  for (const filePath of files) {
    const tsconfigPath = findNearestTsconfig(filePath);
    if (!tsconfigPath) {
      continue;
    }

    if (!filesByTsconfig.has(tsconfigPath)) {
      filesByTsconfig.set(tsconfigPath, new Set());
    }

    filesByTsconfig.get(tsconfigPath)?.add(filePath);
  }

  if (filesByTsconfig.size === 0) {
    return 0;
  }

  let hasErrors = false;

  for (const [tsconfigPath, scopedFiles] of filesByTsconfig) {
    const config = readProjectConfig(tsconfigPath);

    const program = ts.createProgram({
      rootNames: config.fileNames,
      options: config.options,
      projectReferences: config.projectReferences,
    });

    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) =>
        isDiagnosticRelevantToStagedFiles(diagnostic, scopedFiles),
      );

    if (diagnostics.length > 0) {
      hasErrors = true;
      const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => cwd,
        getNewLine: () => ts.sys.newLine,
      });

      const relativeConfig = path.relative(cwd, tsconfigPath) || tsconfigPath;
      process.stderr.write(`\nTypeScript errors (${relativeConfig}):\n`);
      process.stderr.write(formatted);
    }
  }

  return hasErrors ? 1 : 0;
}

process.exit(main());
