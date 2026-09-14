## Why

The Astro marketing site still describes rest2mcp as Charro Digital's internal Bun monorepo template (auth, tRPC, repo layout). The product now ships an MCP studio with a hosted gateway, observability, and platform MCP. Visitors cannot understand what rest2mcp does or why it exists. The site must sell the product truthfully—shipped capabilities today, roadmap items clearly labeled—before a dedicated visual identity pass begins.

## What Changes

- Replace starter-template copy across the marketing home with product-focused content: hero, problem framing, how-it-works loop, shipped features, GUI vs platform MCP, security, audience, FAQ, and final CTA.
- Add a **roadmap** section that lists future capabilities (recipes, marketplace, OpenAPI import, on-prem connector, skills bundles) with honest status labels—not as available today.
- Remove home sections that describe internal stack details (TechStack, repository Architecture tree). Move any residual "built with" mention to the footer only.
- Rewrite meta title/description, header/footer taglines, and en/es locale modules with full parity.
- Add section components and i18n keys for new blocks; keep existing Layout, LanguageSwitcher, and static Astro build model.

**Non-goals:** Visual redesign (tokens, typography, motion). Pricing pages, docs site, blog, case studies (e.g. GHL), screenshots or demo video, dynamic data fetching, SEO beyond meta tags on the home page.

## Capabilities

### New Capabilities

- `marketing-site`: Product marketing home content, section structure, i18n copy rules (shipped vs roadmap), and truthful feature claims aligned with shipped MCP studio specs.

### Modified Capabilities

- None.

## Impact

- **apps/web:** `i18n/locales/en.ts`, `i18n/locales/es.ts`; new/replaced `components/home/*`; `pages/index.astro` and `pages/es/index.astro` section composition; `Layout.astro` footer/meta if needed.
- **No API, db, or apps/app changes.**
