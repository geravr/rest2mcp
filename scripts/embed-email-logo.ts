import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pngPath = join(root, "apps/email/assets/logo-email.png");
const tsPath = join(root, "apps/email/assets/brand-logo.ts");

const png = readFileSync(pngPath);
const base64 = png.toString("base64");

// Read dimensions from PNG IHDR (bytes 16-24)
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);

writeFileSync(
  tsPath,
  [
    "// rest2mcp logo for transactional emails (primary wordmark, embedded base64).",
    "// Regenerate: bun email:embed-logo (after editing apps/email/assets/logo-email.png)",
    "",
    `export const EMAIL_LOGO_DATA_URI = "data:image/png;base64,${base64}";`,
    `export const EMAIL_LOGO_WIDTH = ${width};`,
    `export const EMAIL_LOGO_HEIGHT = ${height};`,
    "",
  ].join("\n"),
);

console.log(`Embedded ${pngPath} → ${tsPath} (${width}x${height})`);
