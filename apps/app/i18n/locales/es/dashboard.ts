export const esDashboard = {
  dashboard: {
    greeting: "Hola, {name}",
    welcome: "Bienvenido a tu panel.",
    userFallback: "Usuario",
    quickActions: {
      profile: {
        title: "Perfil",
        description: "Actualiza tu informaci\u00f3n personal",
        manage: "Gestionar",
      },
      security: {
        title: "Seguridad",
        description: "Verificaci\u00f3n de email y sesiones",
        manage: "Gestionar",
      },
      privacy: {
        title: "Privacidad",
        description: "Preferencias de cookies y telemetr\u00eda",
        manage: "Gestionar",
      },
    },
    gettingStarted: {
      title: "Tus servidores MCP",
      description:
        "Crea un servidor, mapea herramientas REST y copia una URL MCP alojada.",
      routesPath: "/servers",
      viewAll: "Ver servidores",
      empty: "Aún no hay servidores. Crea uno para hospedar tu primer MCP.",
      count: "{count} servidores",
    },
  },
} as const;
