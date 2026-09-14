## ADDED Requirements

### Requirement: Repository excludes Impeccable artifacts

The monorepo SHALL NOT contain Impeccable skill directories, subagent definitions, launcher scripts, or vendored engine binaries under `.cursor/`, `.claude/`, or `.agents/`.

#### Scenario: Skill directories absent

- **WHEN** a contributor lists paths matching `**/skills/impeccable/**`
- **THEN** no files are returned in the repository working tree

#### Scenario: Subagent definitions absent

- **WHEN** a contributor lists paths matching `**/agents/impeccable-*.md`
- **THEN** no files are returned in the repository working tree

### Requirement: Tooling config excludes Impeccable paths

ESLint, Prettier, and Git ignore configuration SHALL NOT reference Impeccable skill paths or `.impeccable/` runtime state.

#### Scenario: ESLint ignores clean

- **WHEN** `eslint.config.ts` is read
- **THEN** it does not contain the string `impeccable`

#### Scenario: Prettier ignores clean

- **WHEN** `.prettierignore` is read
- **THEN** it does not contain the string `impeccable`

#### Scenario: Gitignore clean

- **WHEN** `.gitignore` is read
- **THEN** it does not contain the string `impeccable`

### Requirement: Agent and onboarding docs exclude Impeccable

`AGENTS.md` and root `README.md` SHALL NOT mention Impeccable commands, workflows, or visual-identity steps.

#### Scenario: AGENTS.md clean

- **WHEN** root `AGENTS.md` is read
- **THEN** it does not contain the string `impeccable` (case-insensitive)

#### Scenario: README.md clean

- **WHEN** root `README.md` is read
- **THEN** it does not contain the string `impeccable` (case-insensitive)

### Requirement: OpenSpec history excludes Impeccable references

All files under `openspec/` except the active change directory `openspec/changes/remove-impeccable/` SHALL NOT contain the string `impeccable` (case-insensitive), including archived changes.

#### Scenario: OpenSpec grep clean

- **WHEN** a search for `impeccable` runs under `openspec/` excluding `openspec/changes/remove-impeccable/`
- **THEN** zero matches are returned

### Requirement: Global developer environment cleanup documented

The change design SHALL document steps to remove Impeccable from the developer machine (`~/.impeccable` cache and global skill copies outside this repo).

#### Scenario: Design includes global uninstall

- **WHEN** `design.md` for this change is read
- **THEN** it lists concrete global cleanup paths and verification commands
