export const en = {
  meta: {
    title: "rest2mcp — REST-to-MCP service",
    description:
      "Map REST APIs to curated MCP tools with a hosted gateway, playground testing, and agent-ready observability.",
  },
  header: {
    logoAlt: "rest2mcp",
    skipToContent: "Skip to content",
    login: "Log in",
    signup: "Sign up",
    langSwitcher: {
      ariaLabel: "Change language",
      en: "EN",
      es: "ES",
      enAriaLabel: "English",
      esAriaLabel: "Español",
    },
  },
  footer: {
    tagline: "rest2mcp · REST-to-MCP service",
    description:
      "Build intentional MCP tools from your APIs, test in a playground, and connect any Streamable HTTP client. Built with a modern web stack.",
    startHeading: "Get started",
    navLabel: "Account links",
    copyright: "All rights reserved.",
    links: {
      login: "Log in",
      signup: "Sign up",
    },
  },
  hero: {
    title: "Turn your REST API into an MCP your agent can trust",
    subtitle:
      "rest2mcp is a hosted service for mapping endpoints to curated tools—not bulk auto-generation. Import from curl, test in a playground, and connect via the gateway.",
    ctaStart: "Sign up",
    ctaDocs: "How it works",
  },
  problem: {
    title: "Auto-generated MCP catalogs break agents",
    body: "Dumping every OpenAPI operation into a server gives agents hundreds of poorly named tools. They waste tokens, pick the wrong call, and sometimes trigger destructive mutations.",
    bullets: [
      {
        title: "Too many tools",
        desc: "Large catalogs dilute context and confuse model selection.",
      },
      {
        title: "Poor names and schemas",
        desc: "Generated labels rarely match how agents reason about tasks.",
      },
      {
        title: "Risky by default",
        desc: "Bulk exposure increases the chance of wrong or destructive calls.",
      },
    ],
    contrast:
      "rest2mcp starts with intention: fewer tools, clear names, and schemas designed for agent success.",
  },
  howItWorks: {
    title: "How it works",
    subtitle: "Four steps from API to agent-ready MCP.",
    steps: [
      {
        title: "Create a server",
        desc: "Set your base URL, default headers, and variables—including encrypted secrets.",
      },
      {
        title: "Map tools",
        desc: "Import from curl with preview or define tools manually with params and input schemas.",
      },
      {
        title: "Test in the playground",
        desc: "Run calls with a traffic light, review redacted logs, and tune before going live.",
      },
      {
        title: "Connect your agent",
        desc: "Use your hosted MCP URL and a one-time agent token with Streamable HTTP.",
      },
    ],
  },
  features: {
    title: "Shipped today",
    subtitle: "Capabilities available in the console now—not roadmap promises.",
    items: [
      {
        title: "Curl import with preview",
        desc: "Paste a curl command, preview the request, and mark up fields before saving as a tool.",
      },
      {
        title: "Tool params & schemas",
        desc: "Define query, path, body, and headers with typed input schemas agents can follow.",
      },
      {
        title: "Variables & secrets",
        desc: "Store server variables with encrypted secret handling—never returned in reads or logs.",
      },
      {
        title: "Hosted MCP gateway",
        desc: "Each server gets a stable /mcp/{serverId} URL for agent connections.",
      },
      {
        title: "Playground & traffic light",
        desc: "Execute tools in-browser with clear success, warning, and error signals.",
      },
      {
        title: "Redacted call logs",
        desc: "Review request history with secrets stripped from displayed logs.",
      },
      {
        title: "Mutation guard",
        desc: "POST, PUT, PATCH, and DELETE stay blocked on each tool until you explicitly allow mutations for that tool.",
      },
      {
        title: "Platform MCP",
        desc: "Author servers from an external agent via /api/platform-mcp—changes sync with the GUI.",
      },
      {
        title: "Custom server icons",
        desc: "Upload an icon or use an auto-generated fallback for each server.",
      },
    ],
  },
  workflows: {
    title: "Two ways to build",
    subtitle:
      "Use the GUI or configure from your agent—same servers, same tools.",
    gui: {
      title: "Web GUI",
      desc: "Visual authoring for consultants and developers who want full control.",
      bullets: [
        "Import curl and fine-tune tool mappings",
        "Run the playground and read traffic-light results",
        "Manage variables, headers, and mutation settings",
      ],
    },
    platformMcp: {
      title: "Platform MCP",
      desc: "Let an external agent create and update servers in conversation.",
      bullets: [
        "Connect via /api/platform-mcp with your agent token",
        "Create servers, tools, and variables programmatically",
        "See every change reflected instantly in the GUI",
      ],
    },
  },
  security: {
    title: "Built for trust",
    subtitle: "Security boundaries that keep your API keys and agents safe.",
    bullets: [
      {
        title: "Encrypted secrets",
        desc: "Secret variables are encrypted at rest and redacted from reads and logs.",
      },
      {
        title: "SSRF allowlist",
        desc: "Outbound requests only reach hosts you allow—no arbitrary URL fetches.",
      },
      {
        title: "Mutation guard",
        desc: "POST, PUT, PATCH, and DELETE stay disabled on each tool until you opt in per tool.",
      },
      {
        title: "One-time agent tokens",
        desc: "Tokens are shown once at creation—store them in your agent config.",
      },
      {
        title: "Per-user isolation",
        desc: "Servers, tools, and logs belong to your account only.",
      },
    ],
  },
  roadmap: {
    title: "Roadmap",
    subtitle: "What we are exploring next—clearly labeled, not shipped yet.",
    statusLabels: {
      planned: "Planned",
      exploring: "Exploring",
    },
    items: [
      {
        title: "Recipe templates",
        desc: "Save and reuse server configurations as named templates.",
        status: "planned",
      },
      {
        title: "Recipe marketplace",
        desc: "Share or discover community recipes for common API patterns.",
        status: "planned",
      },
      {
        title: "OpenAPI import",
        desc: "Bulk import from OpenAPI specs alongside curl and manual tools.",
        status: "planned",
      },
      {
        title: "On-prem connector",
        desc: "A local tunnel or connector for APIs that cannot face the public gateway.",
        status: "exploring",
      },
      {
        title: "Skills bundles",
        desc: "Package curated tool sets for specific agent workflows.",
        status: "planned",
      },
      {
        title: "Multipart & file tools",
        desc: "First-class support for file upload and multipart request bodies.",
        status: "exploring",
      },
    ],
  },
  audience: {
    title: "Who it's for",
    subtitle:
      "Teams and individuals who need curated MCP tools, not bulk API dumps.",
    personas: [
      {
        title: "Consultant / implementer",
        desc: "Ship MCP integrations for clients without maintaining custom proxy code.",
      },
      {
        title: "Developer with your own API",
        desc: "Expose a careful subset of your REST API to agents you control.",
      },
      {
        title: "Agent power user",
        desc: "Fill gaps in official MCPs with tools tailored to how you actually work.",
      },
    ],
  },
  finalCta: {
    title: "Start building your MCP",
    subtitle:
      "Sign up, create a server, and connect your first agent in minutes.",
    cta: "Sign up",
  },
  faq: {
    title: "Frequently Asked Questions",
    items: [
      {
        q: "Do I need an OpenAPI spec?",
        a: "No. Start with curl import or manual tool definitions today. OpenAPI import is on the roadmap.",
      },
      {
        q: "Does rest2mcp replace official MCPs?",
        a: "Usually not—it complements them. Use official MCPs where they exist and rest2mcp for APIs and workflows they do not cover.",
      },
      {
        q: "Can I connect to local or on-prem software?",
        a: "Today the hosted gateway calls public HTTPS endpoints you configure. An on-prem connector is on the roadmap for APIs behind a firewall.",
      },
      {
        q: "How many tools can one server have?",
        a: "Each server supports up to 50 tools—a deliberate limit that keeps catalogs agent-friendly.",
      },
      {
        q: "Which MCP clients are supported?",
        a: "Any client that speaks Streamable HTTP with Bearer authentication. Paste your gateway URL and agent token into Cursor, Claude Desktop, or compatible hosts.",
      },
      {
        q: "What happens when I pause a server?",
        a: "A paused server rejects tool execution through the gateway and shows a paused traffic light until you resume it. Agents may still connect, but calls will fail until the server is live again.",
      },
    ],
  },
} as const;
