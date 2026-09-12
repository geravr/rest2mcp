export const enDashboard = {
  dashboard: {
    greeting: "Hi, {name}",
    welcome: "Welcome to your dashboard.",
    userFallback: "User",
    quickActions: {
      profile: {
        title: "Profile",
        description: "Update your personal information",
        manage: "Manage",
      },
      security: {
        title: "Security",
        description: "Email verification and sessions",
        manage: "Manage",
      },
      privacy: {
        title: "Privacy",
        description: "Cookie and telemetry preferences",
        manage: "Manage",
      },
    },
    gettingStarted: {
      title: "Your MCP servers",
      description:
        "Create a server, map REST tools, and copy a hosted MCP URL.",
      routesPath: "/servers",
      viewAll: "View servers",
      empty: "No servers yet. Create one to host your first MCP.",
      count: "{count} servers",
    },
  },
} as const;
