import { execa } from "execa";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { EOL } from "node:os";

// Create Git-ignored files for environment variable overrides
if (!existsSync("./.env.local")) {
  await writeFile(
    "./.env.local",
    [
      `# Overrides for the \`.env\` file in the root folder.`,
      `# API origin for local Vite proxy lives in root \`.env\` as API_ORIGIN`,
      `# (default http://localhost:3456). Do not invent a separate API_URL here.`,
      "",
    ].join(EOL),
    "utf-8",
  );
}

try {
  await execa("bun", ["run", "tsc", "--build"], { stdin: "inherit" });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
} catch (err) {
  // console.error(err);
}
