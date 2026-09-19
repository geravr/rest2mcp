export const esLayout = {
  layout: {
    nav: {
      home: "Inicio",
      servers: "Servidores",
      settings: "Configuraci\u00f3n",
    },

    topbar: {
      logoAlt: "rest2mcp",
      primaryNavigation: "Navegaci\u00f3n principal",
      openNavigationMenu: "Abrir men\u00fa de navegaci\u00f3n",
      openUserMenu: "Abrir men\u00fa de usuario",
      userFallback: "Usuario",
      adminPanel: "Panel de administraci\u00f3n",
      settingsLink: "Configuraci\u00f3n",
      signOut: "Cerrar sesi\u00f3n",
      languageSwitcher: "Cambiar idioma",
      languageEnglish: "Ingl\u00e9s",
      languageSpanish: "Espa\u00f1ol",
      settingsSection: "Configuraci\u00f3n",
      themeSwitcher: "Tema",
      themeLight: "Claro",
      themeDark: "Oscuro",
    },

    sidebar: {
      logoAlt: "rest2mcp",
    },
  },

  toasts: {
    observability: {
      enabled: "Cookies de diagnóstico activadas.",
      disabled: "Cookies de diagnóstico desactivadas.",
      privacyUpdated: "Configuración de privacidad y cookies actualizada.",
    },
    admin: {
      registrationEnabled: "Registro p\u00fablico habilitado.",
      registrationDisabled: "Registro p\u00fablico deshabilitado.",
      invitationSent: "Invitaci\u00f3n enviada.",
      invitationRevoked: "Invitaci\u00f3n revocada.",
      userSuspended: "Usuario suspendido.",
      userReactivated: "Usuario reactivado.",
    },
    profile: {
      profileUpdated: "Perfil actualizado correctamente.",
      avatarUpdated: "Avatar actualizado correctamente.",
      emailChangeRequested:
        "Revisa tu email actual para aprobar esta solicitud de cambio.",
    },
    servers: {
      created: "Servidor creado como borrador sin publicar.",
      updated: "Borrador guardado.",
      deleted: "Servidor eliminado.",
      toolCreated: "Herramienta añadida al borrador.",
      toolUpdated: "Herramienta actualizada en el borrador.",
      toolDeleted: "Herramienta eliminada del borrador.",
      variableSaved: "Variable guardada en el borrador.",
      variableDeleted: "Variable eliminada del borrador.",
      tokenCreated: "Token de agente creado.",
      tokenRevoked: "Token de agente revocado.",
      invoked: "Herramienta invocada.",
      copied: "Copiado al portapapeles.",
      published: "Revisión {number} publicada.",
      restored: "Revisión restaurada al borrador.",
    },
    platform: {
      tokenCreated: "Token de plataforma creado.",
      tokenRevoked: "Token de plataforma revocado.",
    },
  },
} as const;
