export const esLayout = {
  layout: {
    nav: {
      home: "Inicio",
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
  },
} as const;
