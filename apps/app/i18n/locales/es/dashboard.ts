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
      title: "Primeros pasos",
      description:
        "Charro Stack es la plantilla interna de Charro Digital. A\u00f1ade tu propio contenido de panel, m\u00e9tricas y flujos respaldados por datos reales. Edita rutas en",
      routesPath: "apps/app/routes/",
    },
  },
} as const;
