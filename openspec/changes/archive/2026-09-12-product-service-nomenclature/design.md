# Design: product-service-nomenclature

## Context

Marketing copy in `apps/web/i18n/locales/{en,es}.ts` and the `marketing-site` OpenSpec capability frame rest2mcp as an "MCP studio" / "estudio REST a MCP." Early product proposals used "studio" to mean an authoring workspace; in Spanish that reads as a creative agency or local tool, not a hosted SaaS. The SPA (`apps/app`) does not use "studio" in user-facing i18n today—the mismatch is concentrated on the marketing site and spec requirements.

Internal code names (`mcp-studio`, `mcp-studio-service.ts`) remain accurate as engineering labels for the control plane and are out of scope.

## Goals / Non-Goals

**Goals:**

- Establish a two-layer vocabulary for user-facing copy:
  - **Product category:** service / servicio (hosted REST-to-MCP offering).
  - **Configuration UI:** console / consola (web GUI where owners manage servers and tools).
- Update all marketing strings that call rest2mcp itself a "studio" or refer to "the studio" as the product.
- Keep en/es locale parity and preserve existing section structure, CTAs, and factual claims (gateway, playground, etc.).

**Non-Goals:**

- Renaming OpenSpec capability ids, API modules, or database artifacts.
- Rewriting hero/problem positioning beyond nomenclature (curated vs bulk generation stays).
- SPA dashboard copy unless a stray "studio" string is found during audit.
- Visual identity or branding work.

## Decisions

### 1. Product noun: "service" / "servicio"

**Choice:** Use _REST-to-MCP service_ (EN) and _servicio REST a MCP_ (ES) in meta titles, taglines, and hero subtitles where the product category appears.

**Alternatives considered:**

| Option                | Rejected because                                            |
| --------------------- | ----------------------------------------------------------- |
| Platform / plataforma | Heavier SaaS tone; user chose "servicio"                    |
| Gateway               | Describes runtime only, not authoring + hosting             |
| Keep "studio"         | Conflicts with product truth and Spanish agency connotation |

### 2. UI noun: "console" / "consola"

**Choice:** When copy refers to where capabilities live today (features subtitle, workflows subtitle), say _console_ / _consola_, not _studio_ / _estudio_.

**Example (EN):** "Capabilities available in the console now" instead of "in the studio now."

**Example (ES):** "Capacidades disponibles en la consola ahora."

### 3. Workflows subtitle: agent drives the console, not the product

**Choice:** "Use the GUI or configure from your agent—same servers, same tools" (EN); equivalent in ES. Avoid "drive the studio" which equates the whole product with a workspace.

### 4. Spec requirements: rename requirement titles in delta

**Choice:** Delta spec replaces requirement headers that embed "studio" (e.g. "MCP studio product" → "hosted REST-to-MCP service") with full MODIFIED blocks so archive merges cleanly.

**Alternative:** ADDED glossary requirement only. Rejected—existing requirements still mandate "studio" language.

### 5. Internal `mcp-studio` references in specs

**Choice:** Specs may still cite `mcp-studio` as the **implementation capability id** when listing shipped features aligned with code. User-visible copy SHALL NOT say "studio."

## Risks / Trade-offs

| Risk                                           | Mitigation                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Residual "studio" in archived OpenSpec changes | Out of scope; main spec + live i18n are source of truth for apply                    |
| "Console" feels enterprise-heavy in ES         | "Consola" is standard for admin UIs; alternative "panel" documented if user feedback |
| Marketing-site-content change overlap          | Apply this change after verifying no duplicate active change edits same strings      |

## Migration Plan

1. Update delta spec under this change.
2. Edit `en.ts` and `es.ts` strings in one commit slice.
3. Grep `apps/web` for `\bstudio\b|\bestudio\b` (case-insensitive) and confirm zero product-framing hits.
4. Run `bun typecheck` (locale typing) and manual spot-check `/` and `/es/`.
5. Archive change to merge spec delta into `openspec/specs/marketing-site/spec.md`.

No deploy ordering constraints; static copy only.

## Open Questions

None—the user confirmed **servicio** as the product category noun.
