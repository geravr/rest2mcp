# Marketing Site

## Purpose

Static Astro marketing home (`/` and `/es/`) that presents rest2mcp as a hosted REST-to-MCP service with truthful shipped vs roadmap copy, en/es locale parity, and CTAs to the SPA.

## Requirements

### Requirement: Home page describes the hosted REST-to-MCP service

The marketing home page (`/` and `/es/`) SHALL present rest2mcp as a **hosted REST-to-MCP service** for mapping REST APIs to curated MCP tools with a gateway, not as an internal monorepo template. User-visible copy SHALL NOT describe Charro Digital template onboarding (`bun rename`, repository directory trees, or "what's included" stack features as the primary value proposition). User-visible copy SHALL NOT call rest2mcp a "studio" or "estudio" as the product category.

#### Scenario: Hero states product value

- **WHEN** a visitor loads the English home page
- **THEN** the hero title and subtitle explain building an MCP from a REST API and connecting an agent, without mentioning Bun, tRPC, or Drizzle as the main offer

#### Scenario: Spanish home matches product framing

- **WHEN** a visitor loads `/es/`
- **THEN** the hero and section headings carry the same product meaning in Spanish locale strings

#### Scenario: Product category avoids studio framing

- **WHEN** a visitor reads the English hero subtitle or footer tagline
- **THEN** rest2mcp is described as a REST-to-MCP service (or equivalent), not as a "studio"

### Requirement: Home page section structure

The home page SHALL compose a scroll-driven Hero, then a short definition of rest2mcp as a hosted REST-to-MCP service, then a Session section that demonstrates the product in three acts (an agent authors a tool in conversation, a config slip hands the connection to a second agent, and a specialist agent puts the tool to work), then a compressed Ledger that absorbs Problem positioning, the How It Works steps, Shipped Features, the two Workflows doors, Security, Roadmap, Audience, FAQ, and Final CTA so every required fact remains findable. The Session SHALL include an interactive picker of orphan endpoints that re-casts the demonstration. The home page SHALL NOT include the former TechStack or Architecture (repository layout) sections.

#### Scenario: Section order on English home

- **WHEN** the English home page is rendered
- **THEN** a short definition of the service appears after Hero, the Session (endpoint picker, BUILD and WORK windows, handshake slip) follows it, the Ledger follows the Session, and Sign up / Log in remain available after FAQ

#### Scenario: Session demonstrates real product capabilities

- **WHEN** a visitor reads or interacts with the Session
- **THEN** the build act reflects platform-MCP authoring, the handshake shows the hosted /mcp/{serverId} URL and one-time token convention, and mutation-guard copy appears for POST/PUT/PATCH/DELETE endpoints but not for GET endpoints

#### Scenario: Template stack sections removed

- **WHEN** the home page is rendered
- **THEN** no section titled or subtitled as internal stack inventory (Bun/Hono/tRPC feature grid or project directory tree) is present

### Requirement: Shipped features reflect implemented service capabilities

The Shipped Features section SHALL list only capabilities that exist in the current product, aligned with `mcp-studio`, `mcp-gateway`, `mcp-observability`, `platform-mcp`, and `mcp-templates` specs. At minimum it SHALL mention: curl import with preview, tool params and input schemas, server variables with secret handling, hosted MCP gateway URL, playground and traffic light, redacted call logs, explicit mutation guard, platform MCP for agent-driven authoring, and optional custom server icons with automatic generated fallback. Section subtitle copy SHALL refer to the **console** (EN) or **consola** (ES), not "studio" or "estudio", when describing where capabilities are available today.

#### Scenario: Curl import claimed as available

- **WHEN** a visitor reads the Shipped Features section
- **THEN** at least one feature item describes importing a tool from a curl command

#### Scenario: Roadmap capabilities not in shipped list

- **WHEN** a visitor reads the Shipped Features section
- **THEN** recipes, marketplace, OpenAPI import, on-prem connector, and skills bundles are not listed as currently available

#### Scenario: Features subtitle uses console vocabulary

- **WHEN** a visitor reads the Shipped Features section subtitle in English
- **THEN** it describes capabilities available in the console now, not in a studio

### Requirement: Roadmap section uses honest status labels

The Roadmap section SHALL list future capabilities separately from shipped features. Each roadmap item SHALL carry a visible status label drawn from locale strings, using at most these statuses: `planned` or `exploring`. Roadmap items SHALL NOT use primary signup CTAs or language implying the capability is live today.

#### Scenario: Recipe marketplace labeled planned

- **WHEN** the Roadmap section mentions recipe sharing or a public marketplace
- **THEN** the item displays a planned or exploring status label from i18n, not "Available now"

#### Scenario: On-prem connector not presented as shipped

- **WHEN** the Roadmap section mentions a local connector or tunnel for on-prem software
- **THEN** the item is in the Roadmap section with an exploring or planned label and does not appear in Shipped Features

### Requirement: Problem and positioning copy

The Problem section SHALL explain why large auto-generated MCP catalogs hurt agent reliability (too many tools, poor names, token waste, wrong or destructive calls). It SHALL position rest2mcp as curated, intention-first tool design rather than bulk OpenAPI conversion.

#### Scenario: Problem contrasts curation vs bulk generation

- **WHEN** a visitor reads the Problem section
- **THEN** copy contrasts many auto-generated tools with fewer curated tools designed for agent success

### Requirement: How-it-works loop

The home page SHALL describe a four-step loop: create server (base URL and variables), map tools (curl or manual form), test in playground (traffic light and logs), connect agent (MCP URL and token). The Session section performs this loop as its three-act demonstration, and the Ledger SHALL list the four ordered steps with titles and artifacts. Steps SHALL be ordered consistently in both locales.

#### Scenario: Four steps present

- **WHEN** the Ledger is rendered
- **THEN** exactly four ordered steps are shown with titles and artifact lines

### Requirement: Workflows section covers GUI and platform MCP

The Workflows section SHALL describe two entry points to the same service: the web GUI (console) for visual authoring and testing, and the platform MCP for building from an external agent in conversation. Copy SHALL state that changes from either entry appear in the other. User-visible copy SHALL NOT refer to driving or operating "the studio" as shorthand for the product.

#### Scenario: Both workflows described

- **WHEN** a visitor reads the Workflows section
- **THEN** both GUI and platform MCP paths are explained

#### Scenario: Workflows subtitle avoids studio vocabulary

- **WHEN** a visitor reads the Workflows section subtitle in Spanish
- **THEN** it describes configuring via the GUI or from an agent, without calling rest2mcp an "estudio"

### Requirement: Security section states trust boundaries

The Security section SHALL summarize, in plain language: encrypted secret variables not returned in reads or logs, SSRF host allowlist, mutations disabled until explicitly allowed, one-time display of agent tokens, and per-user server isolation.

#### Scenario: Secret handling mentioned

- **WHEN** a visitor reads the Security section
- **THEN** at least one bullet explains that secrets are encrypted and redacted from logs

### Requirement: Audience section uses generic personas

The Audience section SHALL describe three personas without naming a specific vertical product as the primary customer: consultant/implementer, developer with their own API, and agent power user closing gaps in official MCPs. It SHALL NOT present a single vertical recipe (e.g. a named CRM or accounting product) as the product itself.

#### Scenario: No single vertical dominates audience

- **WHEN** the Audience section is rendered
- **THEN** no named third-party vertical software brand appears as the headline persona

### Requirement: FAQ answers product questions

The FAQ section SHALL replace template FAQ entries with at least six product questions covering: OpenAPI requirement (not required today), compatibility with existing official MCPs (complement, not always replace), local/on-prem software (gateway today vs connector roadmap), tool limit per server (50), supported MCP clients (Streamable HTTP + Bearer), and pause behavior. It SHALL NOT claim pricing tiers unless a pricing page exists in the same release.

#### Scenario: OpenAPI question answered honestly

- **WHEN** a visitor expands or reads the OpenAPI FAQ item
- **THEN** the answer states curl/manual start is supported and OpenAPI import is future or planned

### Requirement: CTAs link to SPA signup

Primary CTAs in Hero and Final CTA SHALL link to the SPA signup route via `spaUrl("/signup")`. Secondary Hero CTA SHALL link to an in-page anchor on the How It Works section (`#how-it-works`).

#### Scenario: Signup CTA uses spaUrl

- **WHEN** the Hero primary button is rendered
- **THEN** its href resolves to the configured SPA signup URL

### Requirement: Meta and footer use product copy

Locale modules SHALL define product-focused `meta.title`, `meta.description`, `footer.tagline`, and `footer.description`. Footer copy SHALL NOT describe rest2mcp as Charro Digital's internal template. Meta title and footer tagline SHALL use **REST-to-MCP service** (EN) or **servicio REST a MCP** (ES) as the product category, not "studio" or "estudio."

#### Scenario: Meta description is product-focused

- **WHEN** the English home page `<meta name="description">` is rendered
- **THEN** the content describes REST-to-MCP service value, not monorepo cloning

#### Scenario: Meta title uses service category

- **WHEN** the English home page `<title>` is rendered
- **THEN** it includes "REST-to-MCP service" (or equivalent) and does not include "studio"

### Requirement: Locale parity for all marketing strings

Every new or changed user-visible string on the marketing home SHALL exist in both `i18n/locales/en.ts` and `i18n/locales/es.ts` with equivalent meaning. The shared `UI` type SHALL include typed keys for all new sections so section components receive translated props.

#### Scenario: Roadmap status labels in both locales

- **WHEN** roadmap status labels are defined
- **THEN** both English and Spanish locale files export labels for planned and exploring statuses

#### Scenario: Missing Spanish key fails typecheck

- **WHEN** a developer adds a new English marketing key without the Spanish counterpart
- **THEN** TypeScript locale typing or project typecheck fails before merge
