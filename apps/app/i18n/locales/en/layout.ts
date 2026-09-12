export const enLayout = {
  layout: {
    nav: {
      home: "Home",
      settings: "Settings",
    },

    topbar: {
      logoAlt: "rest2mcp",
      primaryNavigation: "Primary navigation",
      openNavigationMenu: "Open navigation menu",
      openUserMenu: "Open user menu",
      userFallback: "User",
      adminPanel: "Admin Panel",
      settingsLink: "Settings",
      signOut: "Sign out",
      languageSwitcher: "Change language",
      languageEnglish: "English",
      languageSpanish: "Spanish",
      settingsSection: "Settings",
      themeSwitcher: "Theme",
      themeLight: "Light",
      themeDark: "Dark",
    },

    sidebar: {
      logoAlt: "rest2mcp",
    },
  },

  toasts: {
    observability: {
      enabled: "Diagnostic cookies enabled.",
      disabled: "Diagnostic cookies disabled.",
      privacyUpdated: "Privacy & cookie settings updated.",
    },
    admin: {
      registrationEnabled: "Public registration enabled.",
      registrationDisabled: "Public registration disabled.",
      invitationSent: "Invitation sent.",
      invitationRevoked: "Invitation revoked.",
      userSuspended: "User suspended.",
      userReactivated: "User reactivated.",
    },
    profile: {
      profileUpdated: "Profile updated successfully.",
      avatarUpdated: "Avatar updated successfully.",
      emailChangeRequested:
        "Check your current email to approve this email change request.",
    },
  },
} as const;
