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
    contrast: "Fewer tools. Names an agent can use. Schemas built for the job.",
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
  define: {
    title: "Make your REST API talk to your AI agent in under 10 minutes.",
    beats: [
      {
        index: "01",
        label: "You pick",
        method: "GET",
        artifact: "/v1/invoices/{id}",
        desc: "Import a curl or pick an endpoint. No full spec, no long setup.",
      },
      {
        index: "02",
        label: "Ready",
        artifact: "get_invoice",
        desc: "We name it and bound the schema. Your agent knows what to call.",
      },
      {
        index: "03",
        label: "You connect",
        artifact: "/mcp/{serverId}",
        desc: "Copy the URL. Paste it into your agent — it can call your API now.",
      },
    ],
  },
  session: {
    title: "One agent builds it. Another puts it to work.",
    pickerLabel: "Pick an orphan endpoint",
    buildHeader: "your agent → rest2mcp",
    workLabel: "WORK",
    liveLabel: "live",
    thinkingLabel: "Thinking",
    toolLabel: "Ran",
    composerHint: "Message rest2mcp",
    composerWorkHint: "Message the specialist",
    cardTitle: "Connection snippet",
    cardTransport: "Streamable HTTP",
    cardAuthLabel: "Authorization",
    guardNote: "mutation guard — allow {method} for this tool",
    playgroundLabel: "playground",
    handshakeCaption:
      "Paste once into Cursor, Claude Desktop, or any Streamable HTTP client.",
    origin: "https://api.example.com",
    serverUrl: "/mcp/srv_9f2c",
    cast: [
      {
        method: "GET",
        path: "/v1/webhooks",
        tool: "list_webhooks",
        schema: "{ }",
        specialist: "ops specialist",
        buildUser:
          "Don't import the whole webhooks resource. I just need a tool that lists them and tells me which ones are failing.",
        buildThink:
          "One read tool. I'll map GET /v1/webhooks to list_webhooks with an empty schema, then run it in the playground.",
        buildTool: "create_tool",
        buildToolDetail: "GET /v1/webhooks → list_webhooks { }",
        buildPlay: "list_webhooks() · healthy",
        buildReply:
          "list_webhooks is on the server. Connection below — paste it once.",
        workUser: "List our webhooks and flag any that are failing.",
        workThink:
          "list_webhooks takes no arguments. I'll call it and read failing from the payload.",
        args: "{ }",
        result: '200 · { "webhooks": 3, "failing": 0 }',
        workReply: "Three webhooks, all healthy. Nothing failing.",
      },
      {
        method: "POST",
        path: "/v1/events/{id}/replay",
        tool: "replay_event",
        schema: "{ id: string }",
        specialist: "ops specialist",
        buildUser:
          "We keep missing deliveries. Map POST /v1/events/{id}/replay to a single tool. Keep mutations blocked until I allow them, then test it.",
        buildThink:
          "A mutation. I'll create replay_event with id: string, leave the guard on, and invoke the playground.",
        buildTool: "create_tool",
        buildToolDetail:
          "POST /v1/events/{id}/replay → replay_event { id: string }",
        buildPlay: 'replay_event({ "id": "evt_117" }) · healthy',
        buildReply:
          "replay_event is on the server. POST stays blocked until you allow it. Connection below — paste it once.",
        workUser: "Replay event evt_117 — the webhook never landed.",
        workThink: "replay_event wants an id. I'll call it with evt_117.",
        args: '{ "id": "evt_117" }',
        result: '200 · { "status": "replayed", "delivered": true }',
        workReply: "evt_117 was replayed and delivered.",
      },
      {
        method: "DELETE",
        path: "/v1/keys/{id}",
        tool: "revoke_key",
        schema: "{ id: string }",
        specialist: "security specialist",
        buildUser:
          "I need a tight tool to revoke a leaked API key. DELETE /v1/keys/{id} only — don't expose the rest of the keys API. Guard the mutation.",
        buildThink:
          "One destructive tool. I'll map revoke_key, keep DELETE blocked until they opt in, and test in the playground.",
        buildTool: "create_tool",
        buildToolDetail: "DELETE /v1/keys/{id} → revoke_key { id: string }",
        buildPlay: 'revoke_key({ "id": "key_32" }) · healthy',
        buildReply:
          "revoke_key is on the server. DELETE stays blocked until you allow it. Connection below — paste it once.",
        workUser: "Revoke key key_32 — it leaked in a screenshot.",
        workThink: "revoke_key takes an id. I'll call it with key_32.",
        args: '{ "id": "key_32" }',
        result: '200 · { "status": "revoked" }',
        workReply: "key_32 is revoked.",
      },
      {
        method: "GET",
        path: "/v1/users/{id}/settings",
        tool: "get_user_settings",
        schema: "{ id: string }",
        specialist: "support specialist",
        buildUser:
          "Support keeps asking for a user's settings. Give me GET /v1/users/{id}/settings as one tool named the way an agent would ask for it.",
        buildThink:
          "A read with one path param. I'll map get_user_settings { id: string } and run the playground.",
        buildTool: "create_tool",
        buildToolDetail:
          "GET /v1/users/{id}/settings → get_user_settings { id: string }",
        buildPlay: 'get_user_settings({ "id": "usr_209" }) · healthy',
        buildReply:
          "get_user_settings is on the server. Connection below — paste it once.",
        workUser: "Fetch settings for user usr_209.",
        workThink: "get_user_settings wants an id. I'll call it with usr_209.",
        args: '{ "id": "usr_209" }',
        result: '200 · { "locale": "es", "theme": "light" }',
        workReply: "usr_209 is on locale es, theme light.",
      },
      {
        method: "POST",
        path: "/v1/invoices/{id}/void",
        tool: "void_invoice",
        schema: "{ id: string }",
        specialist: "billing specialist",
        buildUser:
          "We need a way to void invoices. Don't dump the whole billing API — just POST /v1/invoices/{id}/void. Keep mutations blocked until I allow them, then test it.",
        buildThink:
          "One tool, not the invoices catalog. I'll map that POST to void_invoice, leave the mutation guard on, and run it in the playground.",
        buildTool: "create_tool",
        buildToolDetail:
          "POST /v1/invoices/{id}/void → void_invoice { id: string }",
        buildPlay: 'void_invoice({ "id": "inv_2041" }) · healthy',
        buildReply:
          "void_invoice is on the server. POST stays blocked until you allow it. Connection below — paste it once.",
        workUser: "Void invoice inv_2041 and confirm the credit note.",
        workThink: "void_invoice takes an id. I'll call it with inv_2041.",
        args: '{ "id": "inv_2041" }',
        result: '200 · { "status": "voided", "credit_note": "cn_881" }',
        workReply: "inv_2041 is voided. Credit note cn_881 was issued.",
      },
      {
        method: "POST",
        path: "/v1/orders/{id}/cancel",
        tool: "cancel_order",
        schema: "{ id: string }",
        specialist: "support specialist",
        buildUser:
          "Support needs to cancel an order and notify the customer. Map POST /v1/orders/{id}/cancel. Guard the mutation. Don't pull in the rest of orders.",
        buildThink:
          "A single mutation with an id. I'll create cancel_order, keep POST blocked, and test it.",
        buildTool: "create_tool",
        buildToolDetail:
          "POST /v1/orders/{id}/cancel → cancel_order { id: string }",
        buildPlay: 'cancel_order({ "id": "ord_552" }) · healthy',
        buildReply:
          "cancel_order is on the server. POST stays blocked until you allow it. Connection below — paste it once.",
        workUser: "Cancel order ord_552 and notify the customer.",
        workThink: "cancel_order wants an id. I'll call it with ord_552.",
        args: '{ "id": "ord_552" }',
        result: '200 · { "status": "cancelled", "notified": true }',
        workReply: "ord_552 is cancelled and the customer was notified.",
      },
    ],
  },
  features: {
    title: "Live",
    subtitle: "In the console now.",
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
    title: "Closed",
    subtitle: "Until you open it.",
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
    subtitle: "Labeled. Not shipped.",
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
    subtitle: "A careful MCP, not a dump of the whole API.",
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
        a: "No. Start with curl or a manual tool. OpenAPI import is planned.",
      },
      {
        q: "Does rest2mcp replace official MCPs?",
        a: "No. Use official MCPs where they exist; rest2mcp fills the gaps.",
      },
      {
        q: "Can I connect to local or on-prem software?",
        a: "Today the gateway calls public HTTPS endpoints. An on-prem connector is exploring.",
      },
      {
        q: "How many tools can one server have?",
        a: "50. A hard cap so catalogs stay agent-friendly.",
      },
      {
        q: "Which MCP clients are supported?",
        a: "Any Streamable HTTP client with Bearer auth — Cursor, Claude Desktop, and compatible hosts.",
      },
      {
        q: "What happens when I pause a server?",
        a: "The gateway rejects tool calls until you resume. Agents can still connect.",
      },
    ],
  },
} as const;
