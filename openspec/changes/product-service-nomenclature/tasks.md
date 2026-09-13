# Tasks: product-service-nomenclature

## 1. English marketing copy

- [ ] 1.1 Update `apps/web/i18n/locales/en.ts` — set `meta.title` to `rest2mcp — REST-to-MCP service`
- [ ] 1.2 Update `footer.tagline` to `rest2mcp · REST-to-MCP service`
- [ ] 1.3 Update `hero.subtitle` to describe rest2mcp as a service (hosted gateway, curated tools—not bulk auto-generation); remove "studio"
- [ ] 1.4 Update `features.subtitle` to "Capabilities available in the console now—not roadmap promises."
- [ ] 1.5 Update `workflows.subtitle` to "Use the GUI or configure from your agent—same servers, same tools." (no "drive the studio")

## 2. Spanish marketing copy

- [ ] 2.1 Update `apps/web/i18n/locales/es.ts` — set `meta.title` to `rest2mcp — servicio REST a MCP`
- [ ] 2.2 Update `footer.tagline` to `rest2mcp · servicio REST a MCP`
- [ ] 2.3 Update `hero.subtitle` to describe rest2mcp as a servicio; remove "estudio"
- [ ] 2.4 Update `features.subtitle` to "Capacidades disponibles en la consola ahora—no promesas del roadmap."
- [ ] 2.5 Update `workflows.subtitle` to "Usa la GUI o configura desde tu agente—mismos servidores, mismas herramientas." (no "conduce el estudio")

## 3. Audit and verification

- [ ] 3.1 Grep `apps/web` for `\bstudio\b|\bestudio\b` (case-insensitive) and confirm no product-framing hits remain in locale files
- [ ] 3.2 Grep `apps/app/i18n` for the same pattern; fix any hits if found (unlikely)
- [ ] 3.3 Run `bun typecheck` from repo root
- [ ] 3.4 Run `openspec validate product-service-nomenclature --strict`
