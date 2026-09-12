# Scripts

Utility scripts for development, CI, and maintenance tasks in the monorepo.

## Identity layers

rest2mcp separates two layers:

- **Template layer** (fixed on rename): `LICENSE`, maintainer `README.md`, studio authorship docs.
- **Demo product layer** (renamable): `APP_NAME`, manifests, i18n product name, email fallbacks, meta tags.

When cloning for a new product, run `bun rename` to replace **rest2mcp** with your product name. Template-layer files are excluded automatically.

## Available Scripts

- **`rename.ts`**: Renames the demo product from **rest2mcp** to a custom name across the codebase. Excludes `LICENSE`, `README.md`, and `openspec/`. Supports `--dry-run`. Run with `bun rename` from the repo root.
- **`post-install.ts`**: Creates `.env.local` and other Git-ignored files after `bun install`. Runs automatically via the `prepare` script.
- **`typecheck-staged.ts`**: Typechecks only staged TypeScript files for faster pre-commit hooks. Invoked by `lint-staged`.
- **`mcp.ts`**: Example MCP server stub, not a production integration.

## Usage

Scripts are typically invoked via root-level `package.json` scripts or directly with Bun:

```bash
bun rename               # Rename the demo product (interactive)
bun rename -- --dry-run  # Preview planned renames without writing
bun scripts/post-install.ts  # Run post-install setup
bun scripts/typecheck-staged.ts  # Typecheck staged files
```

## Notes

- Scripts are standalone TypeScript files executed via Bun.
- They use `execa` for shell command execution and `zod` for validation.
- Scripts should be idempotent where possible (safe to run multiple times).
- Do not commit Git-ignored files created by `post-install.ts`.
