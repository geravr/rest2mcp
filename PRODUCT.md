# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users (confirmed):

- **Consultant / implementer:** ships MCP integrations for clients without writing or hosting a custom MCP proxy.
- **Agent power user:** fills gaps in official MCP catalogs with tools that match how they actually work.

Situation: they have a REST API (their own or a client's) that agents cannot use well — there is no official MCP, or the official/generated catalog is too large, poorly named, or unsafe.

Job: map a careful subset of endpoints to tools, test them, and hand an agent a hosted MCP URL plus a token.

A third audience appears in marketing (developer exposing their own API) but was not confirmed as primary.

## Product Purpose

rest2mcp is a hosted service that turns REST APIs into curated MCP tools an agent can trust.

It exists because bulk OpenAPI-to-MCP dumps give agents too many poorly named tools, waste tokens, and raise the chance of wrong or destructive calls.

Success (confirmed): the same day, a user can create a server, map at least one tool, and connect an agent (Cursor, Claude Desktop, or any Streamable HTTP client).

## Positioning

Intention-first mapping, not bulk generation. The user chooses which endpoints become tools, names them for agents, and designs input schemas. rest2mcp hosts the MCP gateway. Neighboring “import the whole OpenAPI spec” products cannot truthfully claim this curated, hosted loop as their default.

It complements official MCPs; it does not replace them.

The product category is **REST-to-MCP service** (EN) / **servicio REST a MCP** (ES). It is not a “studio” or “estudio.”

## Operating Context

- **Console (SPA):** sign in, create servers, import or define tools, manage variables and secrets, run the playground, read redacted logs, copy the connection snippet.
- **Marketing site:** static home (`/` and `/es/`) that explains the service and sends visitors to sign up / log in.
- **Platform MCP:** the same owner can create and update servers from an external agent at `/api/platform-mcp`; changes sync with the GUI.
- **Agent connection:** paste the hosted `/mcp/{serverId}` URL and a one-time Bearer token into a Streamable HTTP client.
- **Authoring materials:** curl commands, HTTPS API origins, headers, path/query/body placeholders (`{{name}}`), encrypted secret variables.
- **Evaluation ritual:** playground invoke with a traffic-light result (healthy / unstable / failing / paused / draft) before going live.

## Capabilities and Constraints

Shipped today (console + gateway):

- Owner CRUD for MCP servers (name, slug, HTTPS/HTTP base URL, optional description and icon).
- Tools from curl import with preview, or manual definition (method, path, params, typed input schemas, query/header/body).
- Server variables with encrypted secrets; secrets are not returned on reads or shown in logs.
- Hosted Streamable HTTP gateway per server at `/mcp/{serverId}`.
- Playground invoke, traffic light, and redacted paginated call logs.
- Mutation guard: POST, PUT, PATCH, and DELETE stay blocked on each tool until the owner opts in for that tool.
- One-time agent tokens (shown once at creation).
- Per-account isolation of servers, tools, tokens, and logs. Accounts are single-user; there is no organization or workspace tenancy.
- Custom server icons (upload) or an automatic fallback.
- Pause/resume: a paused server rejects tool execution through the gateway.
- Hard cap of **50 tools per server**.
- Outbound calls only to hosts on the server allowlist (SSRF protection).
- Today the hosted gateway calls configured public HTTP(S) endpoints; an on-prem connector is not shipped.

Roadmap (not shipped; do not present as live): recipe templates, recipe marketplace, OpenAPI import, skills bundles. Exploring: on-prem connector, multipart/file tools.

Undecided:

- Whether Charro Digital should appear as maker on product surfaces (marketing copyright currently says rest2mcp only).
- Whether the marketing “developer with your own API” persona is a design audience.
- Pricing, licensing, and production legal terms (Terms and Privacy are placeholders).

## Brand Commitments

Binding source: *Manual de identidad visual* (`rest2mcp-brand-guidelines_1.pdf`). Future marketing and app work starts from this system, not from the zinc template look.

- **Concept:** a brand of *oficio* built around **selection**. The 2 is a gate: its openings are the cut that lets only the essential through. Precise, direct, no unnecessary ornament. Must feel like a working instrument, not an AI mascot or generic icon.
- **Name lockup:** always lowercase `rest2mcp` as one piece, with the 2 in the same composition. The wordmark is a custom drawing — never substitute typed text or recreate it in another typeface. Do not condense, stretch, tilt, rotate, add shadow/glow, close the stencil cuts, or change the 2’s color.
- **Symbol:** the 2 may stand alone when the context already names rest2mcp (favicon, avatar, product icon, compact chrome). Use supplied icon files; do not invent extra detail at small sizes. Square lockup keeps its own optical margin — do not crop the 2 to the canvas edge.
- **Clear space:** minimum margin of X on all sides, where X is the height of the 2’s horizontal opening.
- **Minimum size:** wordmark 120 px wide on digital (32 mm print); symbol 16 px digital (6 mm print).
- **Color:** one accent ink only. **Gate Orange** `#FD410B` appears on the 2 in the principal lockup. **Ink** `#0B0B0B` for the rest of the wordmark and primary ink. **Paper** `#FFFFFF`. Prefer the principal lockup on light grounds (preferred for docs, web, and product). Reverse lockup on dark grounds. One-color white lockup on Gate Orange. Never place the logo on irregular photos, textures, or patterns; if needed, put a solid field first.
- **Type:** **Inter** is the support face for product, web, presentations, and docs (SemiBold/Bold titles, Regular body, Medium controls/labels). It is not part of the logo drawing. System monospace for URLs, tool names, code, and technical data — instrumental, not a “terminal” aesthetic.
- **Reproduction:** new work starts from master SVG/PDF, never by re-tracing a PNG or screenshot.
- **Category language:** “REST-to-MCP service” / “servicio REST a MCP.” Never call the product a studio or estudio.
- **Locales:** English and Spanish with parity on all user-visible SPA, marketing, and transactional email copy.
- Shipping wordmark/icon files today: `apps/web/public/`, `apps/app/public/`, `apps/email/assets/`.
- Charro Digital is the template-layer maintainer in internal docs; it is not a confirmed on-product maker lock.

## Evidence on Hand

- Brand manual: `rest2mcp-brand-guidelines_1.pdf` (session attachment; 15 pages).
- Product copy: `apps/web/i18n/locales/en.ts`, `apps/web/i18n/locales/es.ts`, and SPA/email locale modules under `apps/app/i18n` and `apps/email/i18n`.
- Capability specs: `openspec/specs/mcp-studio`, `mcp-gateway`, `mcp-observability`, `platform-mcp`, `mcp-templates`, `marketing-site`.
- Wordmark and favicon set under `apps/web/public/`, `apps/app/public/`, and `apps/email/assets/`.
- No customer names, testimonials, case studies, press, benchmarks, or pricing exist. Future work must not invent them.
- Legal pages in the SPA are Charro Digital / rest2mcp template placeholders, not counsel-reviewed terms.

## Product Principles

1. **Same-day connection.** A first server, one mapped tool, and an agent URL is the job; extra surface that delays that loop is waste.
2. **Intention over inventory.** Prefer fewer, well-named, schema-clear tools over exposing an entire API.
3. **Two equivalent doors.** GUI and Platform MCP author the same servers; neither is a second-class path.
4. **Trust before reach.** Secrets stay encrypted and redacted, mutations stay off until opted in, and outbound hosts stay allowlisted.
5. **Say only what is true.** Category, shipped features, and roadmap stay distinct; gaps in proof stay empty rather than filled.
