## 1. Delete vendored Impeccable trees

- [ ] 1.1 Remove `.cursor/skills/impeccable/`
- [ ] 1.2 Remove `.claude/skills/impeccable/`
- [ ] 1.3 Remove `.agents/skills/impeccable/`
- [ ] 1.4 Remove `.cursor/agents/impeccable-*.md` (4 files)
- [ ] 1.5 Remove `.claude/agents/impeccable-*.md` (4 files)

## 2. Clean repository config and docs

- [ ] 2.1 Remove Impeccable ignore paths from `eslint.config.ts`
- [ ] 2.2 Remove Impeccable lines from `.prettierignore`
- [ ] 2.3 Remove the `# impeccable-ignore-start … end` block from `.gitignore`
- [ ] 2.4 Delete the `/impeccable init` line from `README.md`
- [ ] 2.5 Delete the Impeccable bullet from Starter UI Philosophy in `AGENTS.md`

## 3. Purge archived OpenSpec mentions

- [ ] 3.1 Rewrite `openspec/changes/archive/2026-09-12-marketing-site-content/proposal.md` to remove Impeccable references (preserve meaning: visual identity deferred)
- [ ] 3.2 Rewrite `openspec/changes/archive/2026-09-12-marketing-site-content/design.md` to remove Impeccable references
- [ ] 3.3 Rewrite `openspec/changes/archive/2026-09-12-product-service-nomenclature/design.md` to remove Impeccable references

## 4. Global developer machine cleanup

- [ ] 4.1 Remove `~/.impeccable/` if it exists
- [ ] 4.2 Remove global skill copies if present: `~/.cursor/skills/impeccable/`, `~/.claude/skills/impeccable/`, `~/.codex/skills/impeccable/`, `~/.agents/skills/impeccable/`
- [ ] 4.3 Check for `impeccable` on PATH (`which impeccable`) and remove symlinks or npm global installs if found

## 5. Verification

- [ ] 5.1 Run `rg -i impeccable . --glob '!openspec/changes/remove-impeccable/**'` and confirm zero matches
- [ ] 5.2 Run `rg -i impeccable openspec/ --glob '!changes/remove-impeccable/**'` and confirm zero matches
- [ ] 5.3 Run `bun typecheck` from repo root
- [ ] 5.4 Run `bun lint` from repo root
