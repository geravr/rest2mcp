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
      title: "Getting started",
      description:
        "rest2mcp is Charro Digital's internal template. Add your own dashboard content, metrics, and workflows backed by real data. Edit routes in",
      routesPath: "apps/app/routes/",
    },
  },
} as const;
