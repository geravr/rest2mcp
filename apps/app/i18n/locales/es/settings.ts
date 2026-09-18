export const esSettings = {
  settings: {
    title: "Configuración",
    description: "Gestiona tu cuenta, seguridad y privacidad.",
    tabProfile: "Perfil",
    tabSecurity: "Seguridad",
    tabPrivacy: "Privacidad y Cookies",
    tabPlatform: "MCP de plataforma",

    platform: {
      title: "MCP de plataforma",
      description:
        "Permite que tu agente actual cree servidores y herramientas desde un MCP dedicado. Los tokens requieren alcances y caducan; vuelve a crearlos tras la migración si el tuyo fue revocado.",
      errorGuidance:
        "Los 4xx/5xx del origen terminan como errores de herramienta MCP con un envelope estructurado. Configura la autenticación en Studio por separado: la importación curl nunca guarda credenciales.",
      urlLabel: "Endpoint",
      createToken: "Crear token de plataforma",
      creatingToken: "Creando...",
      revokeToken: "Revocar token",
      revokingToken: "Revocando...",
      tokenShownOnce: "Copia este token ahora. No se volverá a mostrar.",
      hasToken: "Prefijo del token activo: {prefix}",
      noToken: "No hay token de plataforma activo.",
      copySnippet: "Copiar snippet",
      activeScopesLabel: "Alcances:",
      expiresAtLabel: "Expira el {date}",
      scopesLabel: "Alcances para el próximo token",
      expiryLabel: "Expira en",
      expiryDays: "{days} días",
      scopes: {
        read: "Lectura",
        author: "Autoría",
        invoke: "Invocación",
        secret_reference: "Referencia a secretos",
        destructive: "Destructivo",
      },
      scopeDescriptions: {
        read: "Listar servidores, herramientas y metadatos de valores del servidor.",
        author:
          "Crear y editar servidores, herramientas y valores del servidor.",
        invoke: "Invocar herramientas a través del MCP de plataforma.",
        secret_reference:
          "Referenciar ids de secretos existentes en la configuración de auth sin exponer valores.",
        destructive:
          "Eliminar servidores, herramientas y valores del servidor.",
      },
    },

    profile: {
      title: "Perfil",
      unavailableDescription: "Los datos del perfil no están disponibles.",
      errorDescription: "Error al cargar tu perfil.",
      photoLabel: "Foto de perfil",
      photoDescription: "Sube una imagen JPG, PNG o WebP de hasta 5 MB.",
      uploadAvatar: "Subir avatar",
      uploadingAvatar: "Subiendo...",
      invalidAvatarType: "Sube una imagen JPG, PNG o WebP.",
      avatarTooLarge: "Las imágenes de avatar deben pesar 5 MB o menos.",
      nameLabel: "Nombre",
      namePlaceholder: "Ingresa tu nombre",
      nameRequired: "El nombre es obligatorio",
      emailLabel: "Direcci\u00f3n de email",
      emailSectionDescription:
        "Los cambios requieren aprobación desde tu email actual antes de aplicar la nueva dirección.",
      currentEmailLabel: "Email actual: {email}",
      verifiedBadge: "Verificado",
      unverifiedBadge: "No verificado",
      emailRequiredDifferent:
        "Ingresa una dirección de email diferente para continuar.",
      emailInvalid: "Ingresa una dirección de email válida",
      emailChangeFailed: "No se pudo solicitar el cambio de email.",
      requestEmailChange: "Solicitar cambio de email",
      requestingEmailChange: "Solicitando...",
      emailChangeNote:
        "Revisa tu email actual para aprobar esta solicitud de cambio.",
      saveChanges: "Guardar cambios",
      saving: "Guardando...",
    },

    security: {
      title: "Seguridad",
      errorDescription: "Error al cargar los detalles de seguridad.",
      verifiedEmail: "Email verificado",
      verifiedEmailDescription: "Tu email principal está verificado.",
      unverifiedEmailDescription: "Tu email principal aún no está verificado.",
      sendVerificationTo: "Enviar un nuevo enlace de verificación a {email}.",
      sendVerificationEmail: "Enviar email de verificación",
      sendingVerification: "Enviando verificación...",
      verificationEmailFailed: "No se pudo enviar el email de verificación.",
      verificationEmailSent: "Email de verificación enviado.",
      revokeOtherSessionsButton: "Revocar otras sesiones",
      revokingButton: "Revocando...",
      sessionsLabel: "Sesiones activas",
      sessionActions: "Acciones de sesión",
      sessionActionsDescription:
        "Revoca sesiones individuales o cierra sesión en otros dispositivos.",
      sessionsLoadFailed: "No se pudieron cargar las sesiones.",
      noSessions: "No se encontraron sesiones activas.",
      unknownDevice: "Dispositivo desconocido",
      sessionCreatedAt: "Creada {date}",
      sessionCreatedRecently: "Creada recientemente",
      sessionExpiresAt: "Expira {date}",
      sessionRevokeFailed: "No se pudo revocar la sesión seleccionada.",
      sessionRevoked: "Sesión revocada.",
      revokeButton: "Revocar",
      revokeThisSession: "Revocar esta sesi\u00f3n",
      revokeOtherSessionsFailed: "No se pudieron revocar las otras sesiones.",
      otherSessionsRevoked: "Otras sesiones revocadas.",
      currentSession: "Sesi\u00f3n actual",
    },

    privacy: {
      title: "Privacidad y Cookies",
      errorDescription:
        "Error al cargar la configuración de privacidad y cookies.",
      unavailableDescription:
        "La configuración de privacidad y cookies no está disponible actualmente.",
      consentStatus: "Consentimiento de cookies",
      allowed: "Permitido",
      disabled: "Deshabilitado",
      pending: "Decisión pendiente",
      consentDescriptionAllowed:
        "Las cookies de diagnóstico y la telemetría del producto están activas en este navegador.",
      consentDescriptionDisabled:
        "La aplicación mantendrá desactivadas las cookies de diagnóstico y la telemetría del navegador.",
      consentDescriptionPending:
        "Elige si podemos usar cookies para recopilar analítica saneada y diagnósticos en este navegador.",
      lastUpdated: "Última actualización {date}",
      allowObservability: "Aceptar cookies",
      disableObservability: "Rechazar cookies",
      declineObservability: "Rechazar",
      goToSettings: "Personalizar",
      consentBannerTitle: "Uso de Cookies y Privacidad",
      consentBannerDescription:
        "Utilizamos cookies y tecnologías de seguimiento para recopilar analítica saneada del producto, diagnósticos de errores del cliente.",
      errorTracking: "Cookies de seguimiento de errores",
      errorTrackingDescription:
        "Captura fallos inesperados de la UI y errores manejados de alta severidad. Las validaciones y los fallos 4xx rutinarios quedan fuera.",
      sessionReplay: "Cookies de reproducción de sesión",
      sessionReplayDescription:
        "Graba replays enmascarados para depurar incidencias de producción más rápido. Las entradas se ocultan, los bloques sensibles se excluyen y los cuerpos de petición se redactan.",
      browserKeyMissing:
        "Este entorno no expone una clave de PostHog para el navegador, así que la telemetría frontend está inactiva incluso si la habilitas.",
      privacyDefaults: "Valores predeterminados de cookies y privacidad",
      privacyDefaultsDescription:
        "Las entradas y elementos marcados con selectores sensibles se enmascaran. Los frames embebidos de checkout y las regiones bloqueadas se excluyen del replay. Los headers sensibles, emails, tokens y cuerpos de petición se redactan antes de la captura en el navegador.",
    },
  },
} as const;
