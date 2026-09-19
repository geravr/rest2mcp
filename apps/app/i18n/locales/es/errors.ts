import { APP_ERROR_CODES } from "@repo/core";

export const esErrors = {
  errors: {
    auth: {
      failedToLoadSession: "No se pudo cargar la sesi\u00f3n.",
    },
    notFound: {
      code: "404",
      message: "La p\u00e1gina que buscas no existe.",
      goHome: "Ir al inicio",
    },
    errorBoundary: {
      title: "Algo sali\u00f3 mal",
      tryAgain: "Intentar de nuevo",
    },
    unexpected: "Ocurri\u00f3 un error inesperado. Int\u00e9ntalo de nuevo.",
    codes: {
      [APP_ERROR_CODES.AUTHENTICATION_REQUIRED]:
        "Se requiere autenticaci\u00f3n.",
      [APP_ERROR_CODES.ACCOUNT_SUSPENDED]:
        "Tu cuenta ha sido suspendida. Contacta a un administrador.",
      [APP_ERROR_CODES.SUPER_ADMIN_REQUIRED]:
        "Se requiere acceso de superadministrador.",
      [APP_ERROR_CODES.AUTH_UNAVAILABLE]:
        "El servicio de autenticaci\u00f3n no est\u00e1 disponible. Int\u00e9ntalo m\u00e1s tarde.",

      [APP_ERROR_CODES.INVALID_EMAIL]:
        "Introduce una direcci\u00f3n de email v\u00e1lida.",
      [APP_ERROR_CODES.INVALID_INPUT]:
        "Revisa los datos e int\u00e9ntalo de nuevo.",
      [APP_ERROR_CODES.OTP_SEND_RATE_LIMITED]:
        "Demasiados emails de verificaci\u00f3n. Int\u00e9ntalo en breve.",
      [APP_ERROR_CODES.OTP_VERIFY_FAILED]:
        "No se pudo completar la verificaci\u00f3n con este email y c\u00f3digo.",

      [APP_ERROR_CODES.REGISTRATION_DISABLED]:
        "El registro est\u00e1 cerrado. Necesitas una invitaci\u00f3n para registrarte.",
      [APP_ERROR_CODES.INVITATION_EMAIL_MISMATCH]:
        "Esta invitaci\u00f3n es para otro email.",
      [APP_ERROR_CODES.NO_TOKEN_PROVIDED]:
        "No se proporcion\u00f3 token de invitaci\u00f3n.",
      [APP_ERROR_CODES.INVALID_INVITATION]:
        "Esta invitaci\u00f3n no es v\u00e1lida o ha expirado.",
      [APP_ERROR_CODES.INVITATION_NOT_FOUND]: "Invitaci\u00f3n no encontrada.",
      [APP_ERROR_CODES.INVITATION_ALREADY_EXISTS]:
        "Ya existe una invitaci\u00f3n pendiente para este email.",
      [APP_ERROR_CODES.INVITATION_INVALID_STATUS]:
        "Esta invitaci\u00f3n no puede revocarse en su estado actual.",
      [APP_ERROR_CODES.INVITATION_EMAIL_FAILED]:
        "No se pudo enviar el email de invitaci\u00f3n.",

      [APP_ERROR_CODES.USER_NOT_FOUND]: "Usuario no encontrado.",
      [APP_ERROR_CODES.USER_ALREADY_EXISTS]:
        "Ya existe un usuario con este email.",
      [APP_ERROR_CODES.CANNOT_BAN_SELF]: "No puedes suspenderte a ti mismo.",
      [APP_ERROR_CODES.CANNOT_BAN_SUPER_ADMIN]:
        "No se puede suspender a un superadministrador.",
      [APP_ERROR_CODES.USER_NOT_BANNED]: "El usuario no est\u00e1 suspendido.",

      [APP_ERROR_CODES.S3_NOT_CONFIGURED]:
        "El almacenamiento de archivos no est\u00e1 configurado.",
      [APP_ERROR_CODES.FILE_UPLOAD_FAILED]: "No se pudo subir el archivo.",
      [APP_ERROR_CODES.FILE_REQUIRED]: "Se requiere un archivo.",
      [APP_ERROR_CODES.INVALID_DIRECTORY]:
        "El directorio contiene caracteres no v\u00e1lidos.",
      [APP_ERROR_CODES.DIRECTORY_TOO_LONG]: "El directorio es demasiado largo.",
      [APP_ERROR_CODES.FILE_EMPTY]: "El archivo est\u00e1 vac\u00edo.",
      [APP_ERROR_CODES.FILE_TOO_LARGE]: "El archivo es demasiado grande.",
      [APP_ERROR_CODES.STORAGE_KEY_REQUIRED]:
        "Se requiere la clave de almacenamiento.",
      [APP_ERROR_CODES.STORAGE_ACCESS_DENIED]:
        "No tienes acceso a este objeto.",

      [APP_ERROR_CODES.MCP_SERVER_NOT_FOUND]:
        "No se encontr\u00f3 el servidor MCP.",
      [APP_ERROR_CODES.MCP_TOOL_NOT_FOUND]:
        "No se encontr\u00f3 la herramienta MCP.",
      [APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED]:
        "El destino de la petici\u00f3n no est\u00e1 en la lista de hosts permitidos.",
      [APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED]:
        "No puedes mutar esta herramienta hasta que la habilites.",
      [APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID]:
        "Este token de agente no es v\u00e1lido o fue revocado.",
      [APP_ERROR_CODES.MCP_UPSTREAM_ERROR]:
        "La API de origen devolvi\u00f3 un error.",
      [APP_ERROR_CODES.MCP_CURL_INVALID]:
        "No se pudo analizar ese comando curl.",
      [APP_ERROR_CODES.MCP_TOOL_NAME_CONFLICT]:
        "Ya existe una herramienta con este nombre en el servidor.",
      [APP_ERROR_CODES.MCP_SERVER_SLUG_CONFLICT]:
        "Ya existe un servidor con este slug en tu cuenta.",
      [APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED]:
        "Un enlace de la petición no tiene un valor de servidor ni una entrada de agente correspondiente.",
      [APP_ERROR_CODES.MCP_VARIABLE_NAME_CONFLICT]:
        "Ya existe una variable con este nombre en el servidor.",
      [APP_ERROR_CODES.MCP_PLAINTEXT_SECRET]:
        "Guarda los secretos en una variable secreta y referénciala con {{name}} en lugar de pegarlos literalmente.",
      [APP_ERROR_CODES.MCP_COMPILE_INVALID]:
        "La definición de esta herramienta no es válida y no se puede habilitar.",
      [APP_ERROR_CODES.MCP_TOOL_DISABLED]:
        "Esta herramienta está deshabilitada.",
      [APP_ERROR_CODES.MCP_SERVER_PAUSED]:
        "Este servidor MCP está en pausa y no tiene herramientas invocables.",
      [APP_ERROR_CODES.MCP_RATE_LIMITED]:
        "Demasiadas solicitudes. Espera e inténtalo de nuevo.",
      [APP_ERROR_CODES.MCP_TIMEOUT]:
        "La solicitud al origen agotó el tiempo de espera.",
      [APP_ERROR_CODES.MCP_REDIRECT_REJECTED]:
        "La redirección del origen fue rechazada por política.",
      [APP_ERROR_CODES.MCP_PATH_ESCAPE]:
        "La ruta de la solicitud escaparía de la ruta base configurada.",
      [APP_ERROR_CODES.MCP_ORIGIN_INVALID]:
        "El encabezado Origin no está permitido en este endpoint.",
      [APP_ERROR_CODES.MCP_REQUEST_TOO_LARGE]:
        "El cuerpo de la solicitud es demasiado grande.",
      [APP_ERROR_CODES.MCP_SCOPE_DENIED]:
        "Este token de plataforma no incluye el alcance requerido.",
      [APP_ERROR_CODES.MCP_DESTRUCTIVE_CONFIRMATION_REQUIRED]:
        "Confirma el nombre del recurso para continuar esta operación destructiva.",
      [APP_ERROR_CODES.MCP_VALUE_IN_USE]:
        "Este valor del servidor aún está referenciado y no se puede eliminar.",
      [APP_ERROR_CODES.MCP_AUTH_ACK_REQUIRED]:
        "La autenticación por query requiere reconocimiento explícito de exposición del secreto.",
      [APP_ERROR_CODES.MCP_UPSTREAM_HTTP_ERROR]:
        "La API de origen devolvió un error HTTP.",
      [APP_ERROR_CODES.MCP_MUTATION_INDETERMINATE]:
        "La mutación pudo haberse completado, pero el resultado final del origen es desconocido.",
      [APP_ERROR_CODES.MCP_BINARY_UNSUPPORTED]:
        "Las respuestas binarias del origen no se devuelven como texto.",
      [APP_ERROR_CODES.MCP_WRITE_CONFLICT]:
        "Este servidor cambio en otro lugar. Recarga la configuracion mas reciente e intentalo de nuevo.",
      [APP_ERROR_CODES.MCP_TRANSIENT_WRITE_FAILURE]:
        "El cambio no se guardo por un problema temporal de base de datos. Es seguro reintentar.",
      [APP_ERROR_CODES.MCP_PAT_SCOPE_INVALID]:
        "Estos alcances no son válidos juntos. Agrega la dependencia requerida o quita el alcance extra.",
      [APP_ERROR_CODES.MCP_STEP_UP_REQUIRED]:
        "Este token de alto riesgo necesita un código de confirmación por correo nuevo.",
      [APP_ERROR_CODES.MCP_STEP_UP_EXPIRED]:
        "Ese código de confirmación expiró o ya se usó. Solicita uno nuevo.",
      [APP_ERROR_CODES.MCP_PAT_LIMIT_REACHED]:
        "Alcanzaste el máximo de tokens de plataforma activos.",
      [APP_ERROR_CODES.MCP_POLICY_CONFLICT]:
        "La política solicitada del token no es consistente. Revisa los alcances y el modo de recursos.",
      [APP_ERROR_CODES.MCP_RESOURCE_DENIED]:
        "Este token no tiene permitido acceder a ese recurso.",
      [APP_ERROR_CODES.MCP_POLICY_VERSION_UNSUPPORTED]:
        "Este token de plataforma usa una versión de política no compatible y debe recrearse.",

      [APP_ERROR_CODES.MCP_PUBLISH_NOT_READY]:
        "Este borrador tiene errores que impiden publicarlo todavía.",
      [APP_ERROR_CODES.MCP_PUBLISH_STALE_DRAFT]:
        "El borrador cambió después de la vista previa. Revisa los cambios más recientes y publica de nuevo.",
      [APP_ERROR_CODES.MCP_PUBLISH_STALE_REVISION]:
        "La revisión publicada cambió. Recarga el servidor antes de publicar.",
      [APP_ERROR_CODES.MCP_PUBLISH_CANDIDATE_CHANGED]:
        "El borrador cambió desde la vista previa. Vuelve a previsualizar la publicación.",
      [APP_ERROR_CODES.MCP_PUBLISH_WARNINGS_UNACKNOWLEDGED]:
        "Confirma las advertencias de publicación antes de publicar.",
      [APP_ERROR_CODES.MCP_PUBLISH_NO_CHANGES]:
        "No hay cambios publicables en este borrador.",
      [APP_ERROR_CODES.MCP_PUBLISH_IDEMPOTENCY_CONFLICT]:
        "Esta solicitud de publicación ya se usó con contenido diferente.",
      [APP_ERROR_CODES.MCP_PUBLISH_MISSING_SECRET]:
        "Una herramienta publicada referencia un secreto o valor que ya no existe.",
      [APP_ERROR_CODES.MCP_REVISION_NOT_FOUND]:
        "No se encontró la revisión publicada.",
      [APP_ERROR_CODES.MCP_REVISION_NOT_RESTORABLE]:
        "Esta revisión no se puede restaurar al borrador tal cual.",
      [APP_ERROR_CODES.MCP_ACTIVE_SECRET_IN_USE]:
        "Este secreto lo usa la revisión publicada activa y no se puede eliminar.",

      [APP_ERROR_CODES.MCP_TOOL_GROUP_NOT_FOUND]:
        "Ese grupo de herramientas no existe en este servidor.",
      [APP_ERROR_CODES.MCP_TOOL_GROUP_NAME_CONFLICT]:
        "Ya existe un grupo con ese nombre en este servidor.",
      [APP_ERROR_CODES.MCP_TOOL_GROUP_LIMIT_REACHED]:
        "Este servidor alcanzó su límite de grupos de herramientas.",
      [APP_ERROR_CODES.MCP_TOOL_LIMIT_REACHED]:
        "Este servidor alcanzó su límite de herramientas.",

      [APP_ERROR_CODES.MCP_OPENAPI_INVALID]:
        "Ese archivo no es un documento JSON de OpenAPI válido.",
      [APP_ERROR_CODES.MCP_OPENAPI_VERSION_UNSUPPORTED]:
        "Solo se pueden importar documentos JSON de OpenAPI 3.0 y 3.1.",
      [APP_ERROR_CODES.MCP_OPENAPI_LIMIT_EXCEEDED]:
        "El documento es demasiado grande o declara demasiadas operaciones para importar.",
      [APP_ERROR_CODES.MCP_OPENAPI_SOURCE_UNAVAILABLE]:
        "No se pudo obtener la URL del documento de forma segura desde internet público.",
      [APP_ERROR_CODES.MCP_OPENAPI_STALE_PREVIEW]:
        "El documento cambió desde la vista previa. Vuelve a previsualizarlo antes de importar.",
      [APP_ERROR_CODES.MCP_OPENAPI_INVALID_SELECTION]:
        "Revisa las operaciones seleccionadas, los nombres y el grupo antes de importar.",

      [APP_ERROR_CODES.ROUTE_NOT_FOUND]: "Esta ruta de API no existe.",
      [APP_ERROR_CODES.INTERNAL_ERROR]:
        "Ocurri\u00f3 un error inesperado. Int\u00e9ntalo de nuevo.",
    },
  },
} as const;
