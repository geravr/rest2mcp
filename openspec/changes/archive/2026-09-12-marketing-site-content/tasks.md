## 1. i18n foundation

- [x] 1.1 Extend the `UI` type in `apps/web/i18n/index.ts` for new sections: `problem`, `howItWorks`, `features` (rewritten shape), `workflows`, `security`, `roadmap`, `audience`, updated `hero`, `finalCta`, `faq`, `meta`, and `footer`
- [x] 1.2 Replace English locale copy in `apps/web/i18n/locales/en.ts` with product messaging per design (hero through FAQ, meta, footer)
- [x] 1.3 Add equivalent Spanish copy in `apps/web/i18n/locales/es.ts` with full key parity
- [x] 1.4 Define roadmap status label keys (`planned`, `exploring`) in both locales

## 2. Section components

- [x] 2.1 Rewrite `components/home/Hero.astro` for new hero props; secondary CTA anchors to `#how-it-works`
- [x] 2.2 Add `components/home/Problem.astro` with title, body, and contrast bullets from i18n
- [x] 2.3 Add `components/home/HowItWorks.astro` rendering four ordered steps with stable section id `how-it-works`
- [x] 2.4 Rewrite `components/home/Features.astro` as shipped-capability cards with section id `features`
- [x] 2.5 Add `components/home/Workflows.astro` for GUI vs platform MCP columns
- [x] 2.6 Add `components/home/Security.astro` with trust bullets and section id `security`
- [x] 2.7 Add `components/home/Roadmap.astro` listing future items with status labels only (no signup CTAs) and section id `roadmap`
- [x] 2.8 Add `components/home/Audience.astro` with three generic personas
- [x] 2.9 Rewrite `components/home/FAQ.astro` for product FAQ (minimum six items)
- [x] 2.10 Rewrite `components/home/FinalCta.astro` with product CTA copy

## 3. Page composition and cleanup

- [x] 3.1 Update `pages/index.astro` to import new section order; remove `TechStack` and `Architecture`
- [x] 3.2 Update `pages/es/index.astro` with the same section order and imports
- [x] 3.3 Remove unused `TechStack.astro` and `Architecture.astro` or leave files unused only if referenced elsewhere — prefer delete if unreferenced
- [x] 3.4 Update `Layout.astro` footer/header copy consumption if any strings remain hardcoded outside i18n

## 4. Verification

- [x] 4.1 Run `bun check` in `apps/web` and root `bun typecheck`
- [x] 4.2 Run `bun lint` from repo root
- [x] 4.3 Manual smoke: load `/` and `/es/`, verify locale switcher, hero signup CTA, `#how-it-works` anchor, and absence of template stack/architecture sections
- [x] 4.4 Self-review copy against spec: no roadmap item in shipped features; no vertical brand as headline persona; no pricing claims
