# Proposal: product-service-nomenclature

## Why

User-facing copy and the marketing-site spec describe rest2mcp as an "MCP studio" / "estudio REST a MCP." That framing is misleading: rest2mcp is a hosted service that maps REST APIs to curated MCP tools and runs a gateway—not a creative studio or Charro Digital authorship layer. Correct nomenclature improves product clarity for visitors and sets a stable vocabulary for future copy.

## What Changes

- Replace user-visible "studio" / "estudio" product framing on the marketing site with **service** / **servicio** (and "console" / "consola" where copy refers to the configuration UI, not the product category).
- Update `openspec/specs/marketing-site` requirements that mandate "studio" language so they require hosted-service positioning instead.
- Align hero, meta, footer, features subtitle, and workflows subtitle in both `en.ts` and `es.ts` with the new glossary.

**Non-goals:** Renaming internal modules (`mcp-studio`, `mcp-studio-service.ts`), OpenSpec capability ids, or Drizzle Studio commands. No SPA copy changes unless new "studio" strings are discovered during implementation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `marketing-site`: Product category requirements, meta/footer scenarios, workflows and features copy rules—replace "studio" product framing with "hosted REST-to-MCP service" and "console" for the management UI.

## Impact

- `apps/web/i18n/locales/en.ts` and `es.ts` — ~6 strings (meta, tagline, hero, features subtitle, workflows subtitle).
- `openspec/specs/marketing-site/spec.md` — requirement and scenario wording (via delta spec in this change).
- No API, database, or SPA behavior changes.
