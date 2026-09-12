# AGENTS.md

Local guidance for the scripts workspace in `scripts/`. Read [../AGENTS.md](../AGENTS.md) first for monorepo-wide rules.

## Scope

- Applies to utility scripts under `scripts/` used for development, CI, and maintenance tasks.
- Source of truth is live code in `scripts/`, especially [rename.ts](rename.ts), [post-install.ts](post-install.ts), [typecheck-staged.ts](typecheck-staged.ts), and [mcp.ts](mcp.ts).

## Script Conventions

- Scripts are standalone TypeScript files executed via Bun.
- Each script should have a single, well-defined purpose.
- Use `execa` for shell command execution.
- Use `zod` for validating script inputs or environment variables.
- Scripts should be idempotent where possible (safe to run multiple times).

## Existing Scripts

- `rename.ts`: Renames the demo product from **rest2mcp** to a custom name across the codebase. Excludes template-layer files (`LICENSE`, `README.md`, `openspec/`). Supports `--dry-run`.
- `post-install.ts`: Creates `.env.local` and other Git-ignored files after `bun install`.
- `typecheck-staged.ts`: Typechecks only staged TypeScript files for faster pre-commit hooks.
- `mcp.ts`: Example MCP server stub (not a production integration).

## Safety Considerations

- `rename.ts` modifies demo-layer files across the codebase; template-layer paths are excluded. Review changes carefully before committing. Use `--dry-run` to preview.
- `post-install.ts` creates Git-ignored files; do not commit these files.
- `typecheck-staged.ts` is invoked by `lint-staged`; do not invoke it manually unless debugging.
- `mcp.ts` is an example stub, not a production MCP integration; do not invoke it as a live server.

## Anti-patterns

- Adding business logic to scripts; they should be utility-focused.
- Using Node.js-specific APIs when Bun equivalents exist.
- Hardcoding paths or environment-specific values.
- Creating scripts that depend on each other; keep them independent.
- Committing Git-ignored files created by `post-install.ts`.

## Review Priorities

- Verify that scripts are idempotent and safe to run multiple times.
- Ensure scripts use Bun APIs instead of Node.js equivalents where possible.
- Check that file modifications are scoped correctly and do not leak outside the intended area.
- Confirm that scripts validate inputs and fail gracefully on errors.

## Commands

Scripts are invoked via root-level `package.json` scripts or directly with `bun`:

```bash
bun rename               # Rename the project
bun scripts/post-install.ts  # Run post-install setup (usually automatic)
bun scripts/typecheck-staged.ts  # Typecheck staged files (used by lint-staged)
```
