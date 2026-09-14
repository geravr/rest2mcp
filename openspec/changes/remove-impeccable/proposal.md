## Why

The rest2mcp monorepo vendors Impeccable (skills, subagents, config hooks, and ~42 MB of duplicated binaries) as part of the Charro Stack template, but the product never initialized it—no `PRODUCT.md`, `DESIGN.md`, or `.impeccable/` artifacts exist. Keeping unused agent tooling adds repo weight, confuses onboarding, and implies a visual-identity workflow the team will not use.

## What Changes

- **Remove** all Impeccable directories and subagent definitions from the repo (`.cursor/`, `.claude/`, `.agents/`).
- **Remove** Impeccable-related ignores and references from `eslint.config.ts`, `.prettierignore`, `.gitignore`, `AGENTS.md`, and `README.md`.
- **Purge** every remaining mention of Impeccable across the repo, including archived OpenSpec changes.
- **Document** global uninstall steps for the developer machine (`~/.impeccable`, global skills/agents if present).
- **No replacement** visual-identity workflow in agent docs—the zinc scaffold remains until branded manually.

## Capabilities

### New Capabilities

- `agent-tooling`: Repository and agent configuration exclude Impeccable skills, subagents, config hooks, and references.

### Modified Capabilities

<!-- None: no product requirements in openspec/specs/ reference Impeccable. -->

## Non-goals

- Visual redesign, typography, motion, or design tokens for the product.
- Replacing Impeccable with another design-system workflow in `AGENTS.md` or `README.md`.
- Changing application code, UI components, or runtime behavior.

## Impact

- **Repo:** ~169 tracked files deleted; ~6 config/doc files edited; archived OpenSpec prose updated.
- **Agents:** `/impeccable` commands and project-local `impeccable-*` subagents cease to exist in this workspace.
- **Developer machine:** Manual cleanup of `~/.impeccable` and any global Impeccable skills outside this repo (documented in `design.md`, executed during apply).
- **Product:** No user-facing or API impact.
