---
name: openspec-quality-gate
description: Runs the post-implementation quality gate for an OpenSpec change — verify (typecheck, lint, tests, prettier), always ask for review iteration count with a recommendation, launch specialized reviewers, triage findings, apply actionable fixes, and loop until clean or N. Use when /opsx:apply finishes all tasks, when the user asks to close a slice, or when the user runs /opsx:quality-gate or /opsx-quality-gate.
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
---

Run the post-implementation quality gate. Do not implement remaining OpenSpec tasks here.

**Store selection:** If the user names a store or the work lives in one, run `openspec store list --json` and pass `--store <id>` on OpenSpec read/write commands. Without a store, commands act on the nearest local `openspec/` root.

**Input**: Optionally specify a change name. If omitted, infer from context or auto-select when only one active change exists. If ambiguous, run `openspec list --json` and use **AskUserQuestion** / **AskQuestion**.

## When to run

- `/opsx:apply` finished with `remaining = 0` or `state: "all_done"`
- The user asks to close this slice, stop after this batch, or run the quality gate
- Direct invoke: `/opsx:quality-gate` or `/opsx-quality-gate`

Do not run after every task. Do not run when apply is paused on a blocker unless the user asked to close the slice.

This skill authorizes applying **triaged** findings. Ignore reviewer-skill lines that say "do not fix unless asked".

## Steps

1. **Resolve the change** — announce `Using change: <name>`.
2. **Size the diff** (not the spec page count). Use `git status`, `git diff`, and `git diff --stat` for uncommitted work. If the tree is clean, size branch changes against the default base branch.
3. **VERIFY first** (not counted as a review iteration). Do not ask before this.
4. **ALWAYS ask** for review depth with a recommendation. Wait for the answer.
5. **Review loop** `1..N` with early exit, or stop if the user chose verify-only / skip.
6. **Report** and suggest `/opsx:archive` only when tasks are complete and the gate finished or was skipped.

## 1. Size

Count files and lines in the implementation diff. Ignore generated/artifact folders (`node_modules`, `dist`, `.astro`).

**Risk flags** (security reviewer required if any match in paths or hunks):

- auth, session, cookie, otp, passkey, password, token
- organization, tenant, `activeOrganizationId`, membership
- storage, upload, S3
- admin, `superAdminProcedure`, `publicProcedure`
- env, secret, credential
- payment, billing
- email delivery

**UI flags:** `apps/app`, `apps/web`, `packages/ui`, routes, client state.

**Recommended N and reviewers** (cap **3**):

| Profile                                                  | N                     | Reviewers                                     |
| -------------------------------------------------------- | --------------------- | --------------------------------------------- |
| No application code (markdown / OpenSpec artifacts only) | verify-only           | none                                          |
| Small: ≤3 files, ≤80 lines, no security, no schema       | 1                     | correctness                                   |
| Medium: ≤15 files or a normal feature, no security       | 2                     | correctness + tests or UI                     |
| Large: >15 files or cross-workspace                      | 3                     | correctness + tests/UI + security if any risk |
| Any security flag, even if small                         | `max(recommended, 2)` | include security                              |

UI reviewer only if UI flags are present. Tests reviewer if API, schema, or new behavior is present.

## 2. VERIFY

From the repo root, in this order:

1. `bun typecheck`
2. `bun lint`
3. Focused tests for touched workspaces (e.g. `bun test` / `bun api:test` / `bun app:test`). Skip tests only when the diff has no application code.
4. `bunx prettier --write .`

If UI flags are present, exercise the changed flow (browser tools, or the closest substitute) — not a single screenshot.

If VERIFY fails because of this change: fix and re-run once. If it still fails, **pause** and do not start reviews.

If failures are clearly pre-existing and unrelated, note them and continue only after saying so.

Show VERIFY results before the ask.

## 3. Ask (always)

Use **AskUserQuestion** / **AskQuestion**. Mark the recommended option. Do not skip this prompt.

Show: change name, file/line stats, risk flags, VERIFY status, recommended N, recommended reviewers.

Options (adapt labels to the recommendation):

1. Recommended — `N=<n>` with `<reviewers>` (Recommended)
2. Verify only — no reviewers
3. 1 review iteration
4. 2 review iterations
5. 3 review iterations
6. Skip the quality gate

If the user picks 1/2/3, keep the **recommended reviewer set**. N is loop count only.

- **Skip:** stop. Report VERIFY. Do not review.
- **Verify only:** stop after a green VERIFY (already done unless you had to re-fix).

## 4. Review loop

VERIFY is not an iteration. Cap N at 3.

Each iteration:

1. Launch **distinct** reviewers in **one parallel wave** (2–3 max). Never launch identical `auto` clones.
2. Triage the combined findings.
3. Apply only actionable items.
4. Re-VERIFY.
5. **Early exit** if no actionable findings remain.
6. Pause if VERIFY is red and cannot be fixed.

Iteration 2+ reviews the **new fix diff** only. Pass previously discarded findings and tell reviewers not to re-raise them.

### Reviewers

Launch specialized lenses, not a swarm of the same prompt.

**Cursor** (when the matching Task subagent exists):

- correctness → `bugbot` with:

  ```text
  Full Repository Path: <absolute repository path>
  Diff: uncommitted changes
  Custom Instructions: Review only this change. Do not propose out-of-scope refactors. Do not re-raise: <discarded list or "none">.
  ```

  If the tree is clean, use `Diff: branch changes` instead.

- security → `security-review` with the same prompt shape (`Diff` + optional `Custom Instructions`). Launch only when security is in the reviewer set.
- tests or UI → `generalPurpose` (`inherit` model) with a single-lens prompt.

**Claude / Codex / fallback:** launch parallel general-purpose subagents with the same lenses.

Every reviewer must return rows of: **Severity**, **Location** (`file:line`), **Finding**. Discard any finding without `file:line`.

## 5. Triage

| Class                                                              | Action             |
| ------------------------------------------------------------------ | ------------------ |
| Bug, security issue, type/test failure, regression in touched code | Apply              |
| Clear local improvement aligned with the spec                      | Apply              |
| Style nit, speculative refactor, nice-to-have                      | Discard            |
| Behavior or architecture outside the spec                          | Ask — do not apply |

This skill does not authorize drive-by refactors.

## Output

```
## Quality Gate

**Change:** <name>
**Verify:** typecheck / lint / tests / prettier — pass or fail
**Recommendation:** N=<n>, reviewers: <list>
**User chose:** <option>
**Iterations run:** <k> of <N> (early exit: yes/no)

### Applied
- <file:line> — <what changed>

### Discarded
- <file:line> — <why>

### Asked (unresolved)
- <item> — waiting on user

Ready to archive with `/opsx:archive`.
```

If tasks remain (close-slice), say so and do **not** suggest archive.

## Guardrails

- Always VERIFY before asking. Always ask. Never invent a skip.
- Early-exit when the latest wave has no actionable findings.
- Do not exceed 3 iterations.
- Do not re-litigate discarded findings.
- Do not start reviews on a red VERIFY caused by this change.
- Keep fixes scoped to triaged findings.
- Language of identifiers, comments, and product UI stays English.
