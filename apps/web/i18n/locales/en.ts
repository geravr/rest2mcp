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
      "Map the endpoints that matter, test them in the playground, and hand any Streamable HTTP client a hosted MCP URL.",
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
    title: "A dump is not a catalog an agent can use",
    body: "Dumping every OpenAPI operation into a server hands an agent hundreds of poorly named tools. Context fills with noise. The model picks the wrong call — and sometimes a destructive one.",
    bullets: [
      {
        title: "Too many tools",
        desc: "Large catalogs dilute context and confuse which call to make.",
      },
      {
        title: "Poor names and schemas",
        desc: "Generated labels rarely match how an agent reasons about a task.",
      },
      {
        title: "Risky by default",
        desc: "Bulk exposure raises the chance of a wrong or destructive call.",
      },
    ],
    leftoverLabel: "Does not pass",
    passedLabel: "Passes",
    closedLabel: "Stays closed",
    contrast:
      "rest2mcp starts with intention: fewer tools, names an agent can use, schemas built for the job.",
  },
  howItWorks: {
    title: "The same day",
    subtitle: "Create a server, map a tool, test it, connect an agent.",
    curlCommand: "curl -X GET",
    curlPath: "/v1/invoices/{id}",
    token: "Bearer •••••",
    steps: [
      {
        title: "Create a server",
        desc: "Set the HTTPS origin, default headers, and variables — including encrypted secrets.",
        artifact: "https://api.example.com",
      },
      {
        title: "Map a tool",
        desc: "Import from curl with preview, or define the method, path, params, and input schema by hand.",
        artifact: "get_invoice",
      },
      {
        title: "Test in the playground",
        desc: "Invoke the tool, read the traffic light, and check redacted logs before it goes live.",
        artifact: "healthy",
      },
      {
        title: "Connect your agent",
        desc: "Paste the hosted /mcp/{serverId} URL and a one-time Bearer token into any Streamable HTTP client.",
        artifact: "/mcp/{serverId}",
      },
    ],
  },
  session: {
    title: "One agent builds it. Another puts it to work.",
    pickerLabel: "Pick an orphan endpoint",
    buildHeader: "BUILD · your agent → rest2mcp",
    workLabel: "WORK",
    liveLabel: "live",
    guardNote: "mutation guard — allow {method} for this tool",
    playgroundLabel: "playground",
    handshakeCaption: "the handshake — paste once",
    origin: "https://api.example.com",
    serverUrl: "/mcp/srv_9f2c",
    cast: [
      {
        method: "GET",
        path: "/v1/webhooks",
        tool: "list_webhooks",
        schema: "{ }",
        specialist: "ops specialist",
        task: "List our webhooks and flag any that are failing.",
        args: "{ }",
        result: "200 · { \"webhooks\": 3, \"failing\": 0 }",
        done: "Done — 3 webhooks, all healthy.",
      },
      {
        method: "POST",
        path: "/v1/events/{id}/replay",
        tool: "replay_event",
        schema: "{ id: string }",
        specialist: "ops specialist",
        task: "Replay event evt_117 — the webhook never landed.",
        args: "{ \"id\": \"evt_117\" }",
        result: "200 · { \"status\": \"replayed\", \"delivered\": true }",
        done: "Done — evt_117 replayed and delivered.",
      },
      {
        method: "DELETE",
        path: "/v1/keys/{id}",
        tool: "revoke_key",
        schema: "{ id: string }",
        specialist: "security specialist",
        task: "Revoke key key_32 — it leaked in a screenshot.",
        args: "{ \"id\": \"key_32\" }",
        result: "200 · { \"status\": \"revoked\" }",
        done: "Done — key_32 revoked.",
      },
      {
        method: "GET",
        path: "/v1/users/{id}/settings",
        tool: "get_user_settings",
        schema: "{ id: string }",
        specialist: "support specialist",
        task: "Fetch settings for user usr_209.",
        args: "{ \"id\": \"usr_209\" }",
        result: "200 · { \"locale\": \"es\", \"theme\": \"light\" }",
        done: "Done — settings for usr_209 retrieved.",
      },
      {
        method: "POST",
        path: "/v1/invoices/{id}/void",
        tool: "void_invoice",
        schema: "{ id: string }",
        specialist: "billing specialist",
        task: "Void invoice inv_2041 and confirm the credit note.",
        args: "{ \"id\": \"inv_2041\" }",
        result: "200 · { \"status\": \"voided\", \"credit_note\": \"cn_881\" }",
        done: "Done — inv_2041 voided, credit note cn_881 issued.",
      },
      {
        method: "POST",
        path: "/v1/orders/{id}/cancel",
        tool: "cancel_order",
        schema: "{ id: string }",
        specialist: "support specialist",
        task: "Cancel order ord_552 and notify the customer.",
        args: "{ \"id\": \"ord_552\" }",
        result: "200 · { \"status\": \"cancelled\", \"notified\": true }",
        done: "Done — ord_552 cancelled, customer notified.",
      },
    ],
  },
  features: {
    title: "Shipped in the console",
    subtitle: "What you can use today — not a roadmap.",
    items: [
      {
        title: "Curl import with preview",
        desc: "Paste a curl command, preview the request, and mark fields before saving it as a tool.",
      },
      {
        title: "Tool params & schemas",
        desc: "Query, path, body, and headers with typed input schemas an agent can follow.",
      },
      {
        title: "Variables & secrets",
        desc: "Server variables with encrypted secrets — never returned on reads or shown in logs.",
      },
      {
        title: "Hosted MCP gateway",
        desc: "Each server gets a stable /mcp/{serverId} URL for agent connections.",
      },
      {
        title: "Playground & traffic light",
        desc: "Run tools in the browser with healthy, unstable, failing, paused, and draft signals.",
      },
      {
        title: "Redacted call logs",
        desc: "Paginated request history with secrets stripped from what you see.",
      },
      {
        title: "Mutation guard",
        desc: "POST, PUT, PATCH, and DELETE stay blocked on each tool until you allow that tool to mutate.",
      },
      {
        title: "Platform MCP",
        desc: "Create and update servers from an external agent at /api/platform-mcp — changes sync with the GUI.",
      },
      {
        title: "Custom server icons",
        desc: "Upload an icon, or keep the automatic fallback.",
      },
    ],
  },
  workflows: {
    title: "Two doors",
    subtitle: "Author in the GUI or from an agent. Same servers. Same tools.",
    join: "Web GUI  |  Platform MCP",
    sync: "Every change lands in both.",
    gui: {
      title: "Web GUI",
      desc: "Visual authoring when you want the full console in front of you.",
      bullets: [
        "Import curl and tune the mapping",
        "Run the playground and read the traffic light",
        "Manage variables, headers, and mutation settings",
      ],
    },
    platformMcp: {
      title: "Platform MCP",
      desc: "Let an external agent create and update the same servers in conversation.",
      bullets: [
        "Connect at /api/platform-mcp with your agent token",
        "Create servers, tools, and variables from the agent",
        "See every change land in the GUI",
      ],
    },
  },
  security: {
    title: "What stays closed",
    subtitle: "The opening stays narrow until you open it.",
    bullets: [
      {
        title: "Encrypted secrets",
        desc: "Secret variables are encrypted at rest and redacted from reads and logs.",
      },
      {
        title: "SSRF allowlist",
        desc: "Outbound calls only reach hosts you allow — no arbitrary URL fetches.",
      },
      {
        title: "Mutation guard",
        desc: "POST, PUT, PATCH, and DELETE stay off on each tool until you opt in for that tool.",
      },
      {
        title: "One-time agent tokens",
        desc: "Tokens are shown once at creation. Store them in the agent config.",
      },
      {
        title: "Per-account isolation",
        desc: "Servers, tools, tokens, and logs belong to your account only.",
      },
    ],
  },
  roadmap: {
    title: "Not yet",
    subtitle: "What comes next — labeled, not shipped.",
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
    subtitle: "People who need a careful MCP, not a dump of the whole API.",
    personas: [
      {
        title: "Consultant / implementer",
        desc: "Ship MCP integrations for clients without writing or hosting a custom proxy.",
      },
      {
        title: "Developer with your own API",
        desc: "Expose a careful subset of your REST API to agents you control.",
      },
      {
        title: "Agent power user",
        desc: "Fill gaps in official MCPs with tools that match how you actually work.",
      },
    ],
  },
  finalCta: {
    title: "Create a server today",
    subtitle: "Map one tool. Copy a URL. Connect an agent.",
    cta: "Sign up",
  },
  faq: {
    title: "Before you connect",
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
