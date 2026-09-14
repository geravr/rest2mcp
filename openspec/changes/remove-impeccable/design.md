## Context

Impeccable was vendored into the Charro Stack template as a three-way duplicate (`.cursor/`, `.claude/`, `.agents/`) totaling ~169 tracked files and ~42 MB. The product never ran `/impeccable init`; no `.impeccable/`, `PRODUCT.md`, or root `DESIGN.md` exist. Residual references live in root docs, lint/format ignores, `.gitignore`, and archived OpenSpec prose.

The team decision: stop using Impeccable entirely—no in-repo tooling, no replacement workflow in agent docs, zero mentions anywhere, and global uninstall on developer machines.

## Goals / Non-Goals

**Goals:**

- Delete all Impeccable files and subagents from the repository.
- Remove every config hook and documentation reference (active and archived).
- Verify the repo is clean with a case-insensitive search for `impeccable`.
- Document and execute global cleanup (`~/.impeccable`, global Cursor/Claude skill copies).

**Non-Goals:**

- Product visual identity work or a substitute design-system workflow in `AGENTS.md`.
- Changes to application code, UI, APIs, or database schema.
- Modifying main capability specs under `openspec/specs/` (they already contain no Impeccable references).

## Decisions

### 1. Delete vendored trees wholesale

Remove entire directories rather than pruning individual files:

- `.cursor/skills/impeccable/`
- `.claude/skills/impeccable/`
- `.agents/skills/impeccable/`
- `.cursor/agents/impeccable-*.md`
- `.claude/agents/impeccable-*.md`

**Rationale:** Binary duplication across three toolchains; partial deletion risks orphaned launchers. **Alternative considered:** keep `.cursor/` copy only—rejected because user requested full removal and zero mentions.

### 2. Strip config hooks, not replace them

Remove Impeccable entries from `eslint.config.ts`, `.prettierignore`, and the `# impeccable-ignore-start … end` block in `.gitignore`.

**Rationale:** Ignores exist only to exclude vendored skill JS from lint/format; once deleted, the hooks are dead weight.

### 3. Remove AGENTS.md / README.md lines without substitute guidance

Delete the `/impeccable init` onboarding line and the Starter UI Philosophy bullet referencing Impeccable. Do not add manual branding instructions.

**Rationale:** Explicit user choice—simply remove, no replacement workflow.

### 4. Rewrite archived OpenSpec prose

Edit archived change files under `openspec/changes/archive/` to remove Impeccable mentions while preserving historical intent (e.g., “visual identity deferred” instead of “Impeccable runs later”).

**Rationale:** User requires zero mentions repo-wide, including history.

### 5. Global cleanup on developer machine

During apply, remove:

| Location | Action |
|----------|--------|
| `~/.impeccable/` | `rm -rf` entire cache (engine binaries, version pins) |
| `~/.cursor/skills/impeccable/` | Delete if present (global skill install) |
| `~/.claude/skills/impeccable/` | Delete if present |
| `~/.codex/skills/impeccable/` or `~/.agents/skills/impeccable/` | Delete if present |
| PATH `impeccable` binary | `which impeccable`; remove symlink or npm global if found |

**Verification:**

```bash
rg -i impeccable "/Users/geravilla/Dev Proyects/rest2mcp"
test ! -d ~/.impeccable && echo "global cache gone"
```

**Rationale:** User wants to stop using Impeccable locally and globally, not only in this repo. Global paths are machine-local and cannot be committed; tasks document execution during apply.

## Risks / Trade-offs

- **[Risk] Cursor Task tool still lists built-in `impeccable-*` subagent types** → These are Cursor platform subagents, not repo files. They may remain in the IDE until Cursor updates; out of repo scope. Project-local agent markdown files will be gone.
- **[Risk] Large deletion commit** → Single focused commit; no functional code touched. Mitigation: run `bun typecheck` and `bun lint` after edits.
- **[Risk] Archived OpenSpec edits alter historical record** → Acceptable per user requirement for zero mentions; prose rewritten to preserve meaning without naming the tool.
- **[Risk] Re-install via template sync** → Future template merges could re-vendor Impeccable. Mitigation: new `agent-tooling` spec encodes the exclusion invariant.

## Migration Plan

1. Apply repo deletions and config/doc edits in one change slice.
2. Run global cleanup on the developer machine (documented commands in tasks).
3. Verify with repo-wide `rg -i impeccable` (expect zero matches).
4. Run `bun typecheck` and `bun lint` as sanity checks.
5. No deployment, rollback, or database migration required.

## Open Questions

None—all scope decisions confirmed by the user (zero mentions, no replacement docs, global uninstall).
