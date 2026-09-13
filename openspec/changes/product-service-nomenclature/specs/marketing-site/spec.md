## MODIFIED Requirements

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

### Requirement: Workflows section covers GUI and platform MCP

The Workflows section SHALL describe two entry points to the same service: the web GUI (console) for visual authoring and testing, and the platform MCP for building from an external agent in conversation. Copy SHALL state that changes from either entry appear in the other. User-visible copy SHALL NOT refer to driving or operating "the studio" as shorthand for the product.

#### Scenario: Both workflows described

- **WHEN** a visitor reads the Workflows section
- **THEN** both GUI and platform MCP paths are explained

#### Scenario: Workflows subtitle avoids studio vocabulary

- **WHEN** a visitor reads the Workflows section subtitle in Spanish
- **THEN** it describes configuring via the GUI or from an agent, without calling rest2mcp an "estudio"

### Requirement: Meta and footer use product copy

Locale modules SHALL define product-focused `meta.title`, `meta.description`, `footer.tagline`, and `footer.description`. Footer copy SHALL NOT describe rest2mcp as Charro Digital's internal template. Meta title and footer tagline SHALL use **REST-to-MCP service** (EN) or **servicio REST a MCP** (ES) as the product category, not "studio" or "estudio."

#### Scenario: Meta description is product-focused

- **WHEN** the English home page `<meta name="description">` is rendered
- **THEN** the content describes REST-to-MCP service value, not monorepo cloning

#### Scenario: Meta title uses service category

- **WHEN** the English home page `<title>` is rendered
- **THEN** it includes "REST-to-MCP service" (or equivalent) and does not include "studio"
