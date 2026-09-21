import { MCP_OPENAPI_ISSUE_CODES, type McpOpenApiIssueCode } from "@repo/core";

export const esOpenApi = {
  openApiImport: {
    action: "Importar OpenAPI",
    title: "Importar desde OpenAPI",
    description:
      "Previsualiza un documento JSON de OpenAPI 3.0 o 3.1, elige las operaciones que quieras crear y agrégalas como herramientas de borrador deshabilitadas para su revisión.",

    sourceLegend: "Origen del documento",
    sourceFile: "Archivo",
    sourcePaste: "Pegar JSON",
    sourceUrl: "URL",

    fileLabel: "Archivo JSON",
    fileHint: "JSON de OpenAPI 3.0 o 3.1, hasta 5 MiB. No se admite YAML.",
    fileKindError: "Elige un archivo .json.",
    fileTooLargeError: "Ese archivo supera el límite de 5 MiB.",
    fileReadError: "No se pudo leer ese archivo.",

    pasteLabel: "JSON del documento",
    pastePlaceholder:
      '{\n  "openapi": "3.1.0",\n  "info": { "title": "Ejemplo" }\n}',

    urlLabel: "URL del documento",
    urlHint:
      "Solo HTTPS público. No se envían credenciales, cookies ni la autenticación del servidor al obtenerlo.",

    preview: "Previsualizar documento",
    previewing: "Leyendo documento…",
    previewUnavailable:
      "No se pudo leer el documento. Corrige el origen y vuelve a previsualizarlo.",
    repreview: "Previsualizar de nuevo",

    version: "OpenAPI {version}",
    operationCount: "{count} operaciones",
    selectableCount: "{count} importables",
    blockedCount: "{count} bloqueadas",
    warningCount: "{count} avisos",

    searchLabel: "Buscar operaciones",
    searchPlaceholder: "Filtrar por ruta, nombre o etiqueta",
    noSearchResults: "Ninguna operación coincide con esa búsqueda.",
    noOperations:
      "Este documento no declara operaciones que se puedan importar.",
    selectAll: "Seleccionar todo lo importable",
    clearSelection: "Limpiar selección",
    selectedCount: "{count} seleccionadas",
    selectedOfTotal: "{selected} de {total} seleccionadas",
    emptySelection: "Selecciona al menos una operación para importar.",
    documentIssuesTitle: "Partes de este documento no se pueden leer",
    documentIssuesHint:
      "Estas rutas se omitieron porque no se pudieron resolver dentro del documento. Nunca se obtiene nada fuera de él.",
    ungroupedTag: "Sin etiqueta",

    expandOperation: "Ver detalles",
    collapseOperation: "Ocultar detalles",
    deprecated: "Obsoleta",
    blocked: "Bloqueada",
    warningLabel: "Aviso",
    requestSummary: "Petición",
    noRequestSummary: "Sin cuerpo de petición",
    requestSummaryPath: "ruta",
    requestSummaryQuery: "consulta",
    requestSummaryHeader: "cabecera",
    requestSummaryBody: "cuerpo",
    requestSummaryCount: "{label} {count}",
    requestSummaryNone: "Sin parámetros de ruta, consulta, cabecera ni cuerpo.",

    blockersTitle: "Bloqueadas",
    blockersHint:
      "Las operaciones bloqueadas no se pueden importar. Corrige el documento o exclúyelas.",
    warningsTitle: "Avisos",
    securityTitle: "Autenticación requerida",
    securityHint:
      "Configura estos esquemas en los ajustes del servidor. La importación nunca copia valores de credenciales.",
    securityNone: "No se declara autenticación.",

    nameLabel: "Nombre de la herramienta",
    nameConflict: "Ya lo usa una herramienta existente.",
    nameDuplicate: "Otra operación seleccionada usa este nombre.",
    nameInvalid: "Usa letras minúsculas, números y guiones bajos.",
    namePlaceholder: "get_contact",

    groupLegend: "Ubicación en grupos",
    groupUngrouped: "Dejar sin grupo",
    groupExisting: "Agregar a un grupo existente",
    groupNew: "Crear un grupo nuevo para todo lo seleccionado",
    groupFirstTag: "Crear un grupo por primera etiqueta",
    groupFirstTagHint:
      "Las operaciones conservan su primera etiqueta como grupo. Los grupos faltantes se crean; las operaciones sin etiqueta quedan sin grupo.",
    groupSelectLabel: "Grupo",
    groupSelectPlaceholder: "Elige un grupo",
    groupNewNameLabel: "Nombre del grupo nuevo",
    groupNewNamePlaceholder: "Clientes",
    groupReuse: "Reutilizar {name}",
    groupWillCreate: "Crear {name}",
    groupNoCreations: "No se creará ningún grupo.",
    groupStrategyLabel: "Estrategia de grupos",

    capacityTitle: "Capacidad",
    capacityTools: "{current} de {limit} herramientas en uso",
    capacityGroups: "{current} de {limit} grupos en uso",
    capacityRemaining:
      "Quedan {remaining} huecos de herramienta en este servidor.",
    capacityToolExceeded:
      "Importar {selected} herramientas superaría el límite de {limit}. Este servidor ya tiene {current}.",
    capacityGroupExceeded:
      "Esta importación necesita {selected} grupos pero solo quedan {available} bajo el límite de {limit}.",

    confirm: "Importar {count} herramientas",
    confirmOne: "Importar 1 herramienta",
    confirming: "Importando…",
    cancel: "Cancelar",

    staleTitle: "El documento cambió desde la previsualización",
    staleDescription:
      "El origen ya no coincide con el documento que revisaste, así que no se importó nada. Vuelve a previsualizarlo para revisar la versión actual.",

    resultTitle: "Importación completa",
    resultTools: "{count} herramientas de borrador deshabilitadas creadas.",
    resultToolsOne: "1 herramienta de borrador deshabilitada creada.",
    resultGroups: "{count} grupos creados.",
    resultGroupsOne: "1 grupo creado.",
    resultHint:
      "Las herramientas importadas empiezan deshabilitadas y sin permiso de mutación. Revisa cada una, habilita las que necesites y publica una revisión nueva.",
    resultReview: "Revisar herramientas importadas",
    resultClose: "Cerrar",

    issueDescriptions: {
      [MCP_OPENAPI_ISSUE_CODES.METHOD_UNSUPPORTED]:
        "Este método HTTP no se puede invocar.",
      [MCP_OPENAPI_ISSUE_CODES.EXTERNAL_REFERENCE]:
        "Parte de su definición está fuera de este documento.",
      [MCP_OPENAPI_ISSUE_CODES.CYCLIC_REFERENCE]:
        "Su esquema se refiere a sí mismo.",
      [MCP_OPENAPI_ISSUE_CODES.COOKIE_PARAMETER]:
        "Necesita cookies, que nunca se envían.",
      [MCP_OPENAPI_ISSUE_CODES.MULTIPART_BODY]:
        "Envía un cuerpo multipart o de archivo.",
      [MCP_OPENAPI_ISSUE_CODES.UNSUPPORTED_SERIALIZATION]:
        "Su formato de parámetros no se puede reproducir.",
      [MCP_OPENAPI_ISSUE_CODES.AMBIGUOUS_SERVER]:
        "Su dirección de servidor es ambigua.",
      [MCP_OPENAPI_ISSUE_CODES.UNSUPPORTED_SCHEMA]:
        "Su esquema usa una construcción que no se puede asignar.",
      [MCP_OPENAPI_ISSUE_CODES.AMBIGUOUS_PARAMETER]:
        "Sus parámetros están declarados de forma ambigua.",
      [MCP_OPENAPI_ISSUE_CODES.UNREPRESENTABLE_REQUEST]:
        "Su petición no se puede representar.",
      [MCP_OPENAPI_ISSUE_CODES.FOREIGN_ORIGIN]:
        "Apunta a otro origen distinto de este servidor.",
      [MCP_OPENAPI_ISSUE_CODES.LIMIT_EXCEEDED]:
        "Supera un límite del documento.",
      [MCP_OPENAPI_ISSUE_CODES.DUPLICATE_NAME]:
        "Otra operación seleccionada usa este nombre.",
      [MCP_OPENAPI_ISSUE_CODES.NAME_CONFLICT]:
        "Ya existe una herramienta con este nombre en el servidor.",
      [MCP_OPENAPI_ISSUE_CODES.DEPRECATED]:
        "El documento la marca como obsoleta.",
      [MCP_OPENAPI_ISSUE_CODES.METADATA_IGNORED]:
        "Parte de los metadatos se ignoró.",
      [MCP_OPENAPI_ISSUE_CODES.COMPOSITION_CONFLICT]:
        "Su composición de esquemas asigna tipos o restricciones incompatibles.",
      [MCP_OPENAPI_ISSUE_CODES.REDUCED_VALIDATION]:
        "El valor JSON se puede enviar tal cual, pero la validación de ramas se reduce.",
    } satisfies Record<McpOpenApiIssueCode, string>,
    issueUnknown: "Esta versión de Studio no reconoce este diagnóstico.",
  },
} as const;
