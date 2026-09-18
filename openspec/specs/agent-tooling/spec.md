# Agent Tooling

## Purpose

Repository and agent-configuration hygiene: the monorepo excludes vendored design-agent tooling (Impeccable) and documents agent contracts without referencing removed workflows.

## Requirements

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

### Requirement: OpenSpec archive excludes Impeccable workflow references

Archived OpenSpec change documents under `openspec/changes/archive/` SHALL NOT reference Impeccable commands, skills, subagents, or visual-identity workflows.

#### Scenario: Archive grep clean

- **WHEN** a case-insensitive search for `impeccable` runs under `openspec/changes/archive/`
- **THEN** zero matches are returned
