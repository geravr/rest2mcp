## Context

`apps/web` is a static Astro 5 site with en/es locales in `i18n/locales/*.ts`. Home composition lives in `pages/index.astro` and `pages/es/index.astro`, importing section components from `components/home/`. Current copy still describes the Charro Digital monorepo template (Better Auth, Drizzle, repo tree). The MCP studio product is implemented in `apps/app` and specified in `openspec/specs/mcp-studio`, `mcp-gateway`, `mcp-observability`, `mcp-platform`, and `mcp-templates`. Visual identity remains the zinc starter scaffold until a later branding pass on real product screens.

## Goals / Non-Goals

**Goals:**

- Replace template marketing with truthful product messaging aligned to shipped OpenSpec capabilities.
- Restructure the home page into scannable sections: hero, problem, how-it-works, shipped features, workflows (GUI + platform MCP), security, roadmap, audience, FAQ, final CTA.
- Enforce en/es locale parity through typed i18n keys; section components receive props, not inline strings.
- Label roadmap items with explicit status (`planned` / `exploring`) and never present them as available today.
- Keep static build, existing Layout shell, LanguageSwitcher, and SPA signup/login links via `spaUrl()`.

**Non-Goals:**

- Visual redesign, custom typography, motion systems, or a formal design-system document.
- Pricing, docs, blog, case studies, screenshots, or video.
- New routes beyond home (unless footer anchor links only).
- API/backend changes.

## Decisions

### 1. Content lives in i18n locale modules, not components

All user-visible strings stay in `i18n/locales/en.ts` and `es.ts` with a typed `UI` shape extended for new sections. Section Astro files accept typed props (same pattern as current `Hero.astro`, `Features.astro`).

**Rationale:** Matches `apps/web/AGENTS.md` i18n rules and keeps copy editable without touching markup.

**Alternative considered:** Markdown content collections — rejected; overkill for one home page and breaks existing locale typing.

### 2. Replace TechStack and Architecture; do not relocate as full sections

Remove `TechStack.astro` and `Architecture.astro` from home composition. Optional one-line "Built with modern web stack" in footer only — no Bun/tRPC/Drizzle feature cards.

**Rationale:** Template infrastructure is not the product story. Users landing from search need MCP value, not monorepo layout.

### 3. Shipped features sourced from OpenSpec, roadmap from proposal non-goals

**Shipped today** (safe to claim on home):

- MCP server CRUD, curl import with preview/markings, manual tools, variables, default headers/query
- Hosted gateway `/mcp/{serverId}`, agent tokens, mutation guard
- Playground, traffic light, redacted call logs
- Platform MCP at `/api/platform-mcp`
- Custom server icon upload with generated fallback icon

**Roadmap only** (labeled, no CTA implying availability):

- Recipes / template save
- Recipe marketplace / sharing
- OpenAPI import
- On-prem connector / tunnel
- Skills bundles
- First-class multipart/file tools

**Rationale:** Starter UI philosophy (AGENTS.md): no fake metrics or aspirational controls. Roadmap section educates without demo theater.

### 4. New section components, minimal styling churn

Add Astro components under `components/home/`:

| Component          | Purpose                                                  |
| ------------------ | -------------------------------------------------------- |
| `Problem.astro`    | Why auto-generated MCP catalogs fail                     |
| `HowItWorks.astro` | Four-step loop (server → tools → playground → connect)   |
| `Features.astro`   | Rewritten — shipped capability cards                     |
| `Workflows.astro`  | GUI vs platform MCP                                      |
| `Security.astro`   | Trust bullets (secrets, SSRF, mutations, isolation)      |
| `Roadmap.astro`    | Future items with status badge text from i18n            |
| `Audience.astro`   | Three buyer personas (consultant, developer, power user) |
| `FAQ.astro`        | Product FAQ (rewrite)                                    |
| `FinalCta.astro`   | Rewrite                                                  |
| `Hero.astro`       | Rewrite props only                                       |

Reuse existing Tailwind utility patterns from current sections (border-b, max-w-7xl, semantic tokens). No new dependencies.

**Rationale:** Content change now; a later layout/branding pass can reshape presentation without rewriting copy.

### 5. In-page anchors for secondary CTA

Hero secondary CTA links to `#how-it-works`. Nav/footer may add anchor links (`#features`, `#security`, `#roadmap`, `#faq`) only if header is updated in the same change — optional in tasks, not required for v1.

### 6. Meta and footer de-template

Update `meta.title`, `meta.description`, `footer.tagline`, and `footer.description` to product copy. Remove "Charro Digital internal template" references.

## Risks / Trade-offs

| Risk                                            | Mitigation                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Copy drifts from product as studio evolves      | Spec ties shipped claims to OpenSpec capabilities; roadmap section isolated           |
| Over-promising roadmap items                    | Status labels in i18n (`planned`, `exploring`); no signup CTAs on roadmap cards       |
| i18n parity drift                               | Extend `UI` type; tasks require both locales in same PR                               |
| Removing stack section disappoints dev audience | Footer one-liner optional; GitHub/README remain for technical audience                |
| Long home page                                  | Clear section headings; anchor links; content-only pass avoids visual density changes |

## Migration Plan

1. Extend i18n types and locale files with new section keys and copy.
2. Add/replace section components; wire in both `pages/index.astro` and `pages/es/index.astro`.
3. Remove TechStack and Architecture imports from pages.
4. Update Layout footer/meta if not fully driven by i18n already.
5. Run `bun check` in `apps/web`, root `bun typecheck`, `bun lint`.
6. Manual smoke: load `/` and `/es/`, verify locale switcher, CTAs to SPA signup.

Rollback: revert `apps/web` changes only; no migrations or API impact.

## Open Questions

- **Pricing FAQ:** Omit until pricing exists, or add honest "pricing TBD" answer — recommend omit.
- **Header nav anchors:** Add product section links in header now vs wait for a layout/branding pass — recommend minimal (hero CTA anchor only) in this change.
