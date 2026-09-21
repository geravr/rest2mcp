export const esSettings = {
  settings: {
    title: "Configuración",
    description: "Gestiona tu cuenta, seguridad y privacidad.",
    tabProfile: "Perfil",
    tabSecurity: "Seguridad",
    tabPrivacy: "Privacidad y Cookies",
    tabPlatform: "MCP de plataforma",
    tabAi: "IA",

    ai: {
      title: "Proveedores de IA",
      description:
        "Conecta un proveedor, verifica un modelo y consulta qué está listo para las funciones de IA.",
      providersTitle: "Proveedores",
      providersDescription:
        "Se usa un proveedor a la vez. Elige un proveedor, conéctalo y verifica un modelo. Las credenciales se guardan cifradas y no se vuelven a mostrar.",
      chooseProvider: "Elige un proveedor para configurar.",
      changeProvider: "Cambiar de proveedor",
      providerNames: {
        openai: "OpenAI",
        anthropic: "Anthropic",
        xai: "xAI",
        meta: "Meta",
        openrouter: "OpenRouter",
        opencode_zen: "OpenCode Zen",
        opencode_go: "OpenCode Go",
      },
      providerDetails: {
        openai: { model: "GPT-4o, o1", useCase: "Popular" },
        anthropic: { model: "Claude Sonnet", useCase: "Recomendado" },
        xai: { model: "Grok", useCase: "Rápido" },
        meta: { model: "Llama", useCase: "Código abierto" },
        openrouter: { model: "100+ modelos", useCase: "Flexible" },
        opencode_zen: { model: "Modelos de código", useCase: "Optimizado" },
        opencode_go: { model: "DeepSeek, GLM", useCase: "Optimizado" },
      },
      searchProviders: "Buscar proveedor...",
      searchModels: "Buscar modelos compatibles...",
      providerCount: "{count} proveedores",
      noProvidersFound: "Ningún proveedor coincide con tu búsqueda.",
      connectKeyTitle: "Conecta tu clave de {provider}",
      connectedKeyTitle: "Tu clave de {provider} está conectada",
      verifyModelTitle: "Verifica un modelo",
      keyStored: "Clave guardada de forma segura",
      keyHelp: "¿Dónde encuentro mi clave de {provider}?",
      encryptedAfterVerify: "Se cifra tras verificar",
      securityCallout:
        "Tus claves se cifran en reposo, nunca se muestran completas y puedes revocarlas cuando quieras.",
      showCredential: "Mostrar clave de API",
      hideCredential: "Ocultar clave de API",
      selectedModel: "Modelo seleccionado",
      back: "Atrás",
      stepperLabel: "Pasos de configuración",
      stepName: "Paso {step}: {label}",
      steps: {
        chooseProvider: "Elige proveedor",
        connectKey: "Conecta tu clave",
        verifyModel: "Verifica un modelo",
        next: "Siguiente",
        done: "Listo",
      },
      states: {
        notConnected: "Sin conectar",
        verified: "Verificado",
        verificationFailed: "Verificación fallida",
      },
      verifiedAtLabel: "Verificado el {date}",
      lastAttemptLabel: "Último intento {date}",
      credentialLabel: "Clave de API",
      credentialPlaceholder: "Pega la clave de API",
      credentialInputHint:
        "Se guarda cifrada tras la verificación. No se vuelve a mostrar.",
      connect: "Conectar y cifrar",
      verifying: "Verificando...",
      rotate: "Rotar clave",
      rotateConfirm: "Guardar nueva clave",
      rotating: "Rotando...",
      remove: "Eliminar",
      removing: "Eliminando...",
      cancel: "Cancelar",
      removeTitle: "Eliminar la conexión del proveedor",
      removeDescription:
        "¿Eliminar {provider}? La credencial almacenada, el catálogo de modelos y la selección verificada de este proveedor se eliminan. Las funciones de IA que la usan dejan de funcionar.",
      removeConfirm: "Eliminar conexión",
      conflictRetryHint:
        "Esta conexión cambió en otro lugar. Se cargó el estado más reciente; inténtalo de nuevo.",
      modelsTitle: "Modelos compatibles",
      modelsDescription:
        "Modelos del catálogo del proveedor calificados para salida de texto estructurado.",
      modelsEmpty: "No se devolvieron modelos compatibles.",
      refreshCatalog: "Actualizar",
      refreshingCatalog: "Actualizando...",
      retry: "Reintentar",
      catalogRetrievedAt: "Obtenido el {date}",
      staleCatalogBanner:
        "La actualización en vivo falló, así que esta lista proviene de la última obtención exitosa.",
      verification: {
        show: "Verificar un modelo",
        hide: "Ocultar verificación",
        disclosure:
          "La verificación envía una pequeña solicitud de salida estructurada al proveedor y puede generar un cargo mínimo en tu cuenta.",
        verifyAndSelect: "Verificar y seleccionar",
        verifying: "Verificando...",
        inProgress:
          "Verificando {model} con tu proveedor. Esto puede tardar unos segundos.",
      },
      configuredTitle: "IA configurada",
      readiness: {
        title: "Capacidades de IA",
        description:
          "Requerido por las funciones de IA que generan salida estructurada.",
        readyLabel: "Listo",
        notReadyLabel: "No listo",
        selectionLabel: "Modelo {model}, verificado el {date}",
        reasons: {
          no_connection: "Aún no hay ningún proveedor conectado.",
          connection_unverified:
            "El proveedor conectado aún no ha sido verificado.",
          no_selection:
            "Conecta un proveedor y luego verifica un modelo para completar la configuración.",
          selection_stale:
            "El modelo verificado ya no es válido. Verifica un modelo de nuevo.",
          model_unavailable:
            "El modelo seleccionado no está disponible actualmente. Verifica un modelo diferente.",
        },
      },
      unsupportedReasons: {
        modality: "No admite la modalidad de texto requerida.",
        context_window_too_small:
          "La ventana de contexto es menor que la requerida.",
        context_window_unknown: "La ventana de contexto es desconocida.",
        structured_output_unsupported: "No admite salida estructurada.",
        route_unresolved:
          "No hay una ruta admitida disponible para este modelo.",
        deprecated: "Este modelo está obsoleto.",
        missing_identity:
          "El modelo carece de metadatos de identidad requeridos.",
      },
      cta: {
        guidance:
          "Las funciones de IA están deshabilitadas hasta que conectes un proveedor y verifiques un modelo.",
        link: "Abrir configuración de IA",
      },
    },

    platform: {
      title: "MCP de plataforma",
      description:
        "Conecta un agente a tu propio Studio mediante un MCP dedicado. Cada token tiene nombre, privilegio mínimo por defecto, un límite de recursos y caducidad.",
      errorGuidance:
        "Los 4xx/5xx del origen terminan como errores de herramienta MCP con un envelope estructurado. Configura la autenticación en Studio por separado: la importación curl nunca guarda credenciales.",
      urlLabel: "Endpoint",
      createToken: "Crear token de plataforma",
      creatingToken: "Creando...",
      revokeToken: "Revocar",
      revokingToken: "Revocando...",
      rotateToken: "Rotar",
      rotatingToken: "Rotando...",
      tokenShownOnce: "Copia este token ahora. No se volverá a mostrar.",
      noToken: "Aún no hay tokens de plataforma.",
      inventoryTitle: "Tokens de plataforma",
      inventoryEmpty: "Crea un token para conectar un agente.",
      nameLabel: "Nombre del token",
      namePlaceholder: "p. ej. Claude desktop",
      scopesLabel: "Alcances",
      presetLabel: "Preajuste",
      advancedLabel: "Alcances avanzados",
      resourceModeLabel: "Acceso a recursos",
      selectedServersLabel: "Servidores seleccionados",
      serversEmpty:
        "Crea o selecciona al menos un servidor para un token de servidores seleccionados.",
      riskLabel: "Riesgo",
      highRiskLabel: "Alto riesgo",
      lowRiskLabel: "Bajo riesgo",
      highRiskWarning:
        "Este token recibe autoridad de alto riesgo y requiere un código de confirmación por correo.",
      ttlLabel: "Expira en",
      ttlDays: "{days} días",
      ttlCapHint: "Máximo {days} días para este permiso.",
      expiresAtLabel: "Expira el {date}",
      lastUsedLabel: "Último uso {date}",
      neverUsedLabel: "Sin uso",
      createdAtLabel: "Creado el {date}",
      revokedLabel: "Revocado",
      activeLabel: "Activo",
      selectedCount: "{count} servidores",
      accountWide: "Toda la cuenta",
      rotateHint:
        "La rotación emite un sucesor y revoca este token de forma atómica.",
      confirmRevoke:
        "¿Revocar este token? Los agentes que lo usan dejan de funcionar de inmediato.",
      stepUp: {
        title: "Confirma el token de alto riesgo",
        hint: "Ingresa el código enviado a tu correo para aprobar este token.",
        codeLabel: "Código por correo",
        sendCode: "Enviar código",
        sendingCode: "Enviando...",
        verifyAndCreate: "Confirmar y crear",
        verifying: "Verificando...",
      },
      presets: {
        inspect: "Inspeccionar",
        build_drafts: "Crear borradores",
        operate_read_only: "Operar solo lectura",
      },
      presetDescriptions: {
        inspect:
          "Leer servidores, herramientas y metadatos de valores no secretos.",
        build_drafts:
          "Crear y editar borradores deshabilitados sin publicarlos.",
        operate_read_only: "Probar herramientas de solo lectura sin mutar.",
      },
      resourceModes: {
        selected: "Servidores seleccionados",
        account: "Toda la cuenta",
      },
      resourceModeDescriptions: {
        selected: "Restringe este token a servidores específicos. Recomendado.",
        account:
          "Accede a servidores presentes y futuros, incluida la creación de borradores.",
      },
      scopes: {
        read: "Lectura",
        observe: "Observación",
        author: "Autoría",
        publish: "Publicación",
        invoke: "Invocación",
        invoke_mutation: "Invocación con mutación",
        secret_reference: "Referencia a secretos",
        destructive: "Destructivo",
      },
      scopeDescriptions: {
        read: "Listar servidores concedidos y metadatos seguros.",
        observe: "Leer bitácoras de llamadas saneadas y salud operativa.",
        author:
          "Crear y editar borradores deshabilitados y configuración no secreta.",
        publish: "Hacer cambios que afectan las herramientas en ejecución.",
        invoke: "Probar herramientas GET/HEAD habilitadas.",
        invoke_mutation:
          "Probar herramientas POST/PUT/PATCH/DELETE habilitadas que permiten mutación.",
        secret_reference:
          "Referenciar ids de secretos existentes sin revelar sus valores.",
        destructive:
          "Eliminar servidores, herramientas y valores tras confirmar el nombre.",
      },
      dependencyHint: "{scope} requiere {dependency}.",
      activity: {
        title: "Actividad reciente del token",
        empty: "Sin actividad reciente de tokens de plataforma.",
        scopeDenied: "Alcance denegado",
        resourceDenied: "Recurso denegado",
        stepUpFailed: "Confirmación fallida",
        destructiveAction: "Acción destructiva",
        mutatingInvocation: "Invocación con mutación",
        tokenIssued: "Token creado",
        tokenRotated: "Token rotado",
        tokenRevoked: "Token revocado",
        outcomeSuccess: "Éxito",
        outcomeDenied: "Denegado",
        outcomeFailure: "Falló",
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
