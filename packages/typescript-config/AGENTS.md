# AGENTS.md

Local guidance for the TypeScript configuration package in `packages/typescript-config/`. Read [../../AGENTS.md](../../AGENTS.md) first for monorepo-wide rules.

## Scope

- Applies to shared TypeScript configurations under `packages/typescript-config/`.
- Source of truth is live code in `packages/typescript-config/`, especially [base.jsonc](base.jsonc), [react.jsonc](react.jsonc), and [node.jsonc](node.jsonc).

## Available Configurations

- `base.jsonc`: Core strict-mode configuration shared by all targets.
- `react.jsonc`: React applications with DOM types and JSX support.
- `node.jsonc`: Node.js/Bun backend services.

## Usage

Extend from the appropriate configuration in your `tsconfig.json`:

```jsonc
// React applications
{ "extends": "@repo/typescript-config/react.jsonc" }

// Node.js/Bun applications
{ "extends": "@repo/typescript-config/node.jsonc" }
```

## Conventions

- All configs inherit from `base.jsonc`, which enables strict mode.
- Do not duplicate settings across configs; inherit and override.
- Use `.jsonc` extension to allow comments in configuration files.
- Keep the package dependency-free; it only contains JSON configuration files.

## Anti-patterns

- Adding React-specific settings to `node.jsonc` or vice versa.
- Duplicating settings from `base.jsonc` in child configs.
- Removing strict mode settings without a documented reason.
- Adding dependencies to this package; it should remain config-only.

## Review Priorities

- Verify that new settings are appropriate for the target (React vs Node).
- Ensure settings inherit from `base.jsonc` rather than duplicating.
- Check that strict mode is not weakened without justification.
- Confirm that the package remains dependency-free.

## Commands

This package has no build or test commands. It is consumed by other workspaces via `extends` in their `tsconfig.json`.
