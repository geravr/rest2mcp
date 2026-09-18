## 1. Delete vendored Impeccable trees

- [x] 1.1 Remove `.cursor/skills/impeccable/`
- [x] 1.2 Remove `.claude/skills/impeccable/`
- [x] 1.3 Remove `.agents/skills/impeccable/`
- [x] 1.4 Remove `.cursor/agents/impeccable-*.md` (4 files)
- [x] 1.5 Remove `.claude/agents/impeccable-*.md` (4 files)

## 2. Clean repository config and docs

- [x] 2.1 Remove Impeccable ignore paths from `eslint.config.ts`
- [x] 2.2 Remove Impeccable lines from `.prettierignore`
- [x] 2.3 Remove the `# impeccable-ignore-start … end` block from `.gitignore`
- [x] 2.4 Delete the `/impeccable init` line from `README.md`
- [x] 2.5 Delete the Impeccable bullet from Starter UI Philosophy in `AGENTS.md`

## 3. Purge archived OpenSpec mentions

- [x] 3.1 Rewrite `openspec/changes/archive/2026-09-12-marketing-site-content/proposal.md` to remove Impeccable references (preserve meaning: visual identity deferred)
- [x] 3.2 Rewrite `openspec/changes/archive/2026-09-12-marketing-site-content/design.md` to remove Impeccable references
- [x] 3.3 Rewrite `openspec/changes/archive/2026-09-12-product-service-nomenclature/design.md` to remove Impeccable references

## 4. Global developer machine cleanup

- [x] 4.1 Remove `~/.impeccable/` if it exists
- [x] 4.2 Remove global skill copies if present: `~/.cursor/skills/impeccable/`, `~/.claude/skills/impeccable/`, `~/.codex/skills/impeccable/`, `~/.agents/skills/impeccable/`
- [x] 4.3 Check for `impeccable` on PATH (`which impeccable`) and remove symlinks or npm global installs if found

## 5. Verification

- [x] 5.1 Run `rg -i impeccable . --glob '!openspec/changes/remove-impeccable/**'` and confirm zero matches
- [x] 5.2 Run `rg -i impeccable openspec/ --glob '!changes/remove-impeccable/**'` and confirm zero matches
- [x] 5.3 Run `bun typecheck` from repo root
- [x] 5.4 Run `bun lint` from repo root
