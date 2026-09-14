export const es = {
  meta: {
    title: "rest2mcp — servicio REST a MCP",
    description:
      "Mapea APIs REST a herramientas MCP curadas con gateway alojado, pruebas en playground y observabilidad lista para agentes.",
  },
  header: {
    logoAlt: "rest2mcp",
    skipToContent: "Saltar al contenido",
    login: "Iniciar sesión",
    signup: "Registrarse",
    langSwitcher: {
      ariaLabel: "Cambiar idioma",
      en: "EN",
      es: "ES",
      enAriaLabel: "English",
      esAriaLabel: "Español",
    },
  },
  footer: {
    tagline: "rest2mcp · servicio REST a MCP",
    description:
      "Mapea los endpoints que importan, pruébalos en el playground y entrega a cualquier cliente Streamable HTTP una URL MCP alojada.",
    startHeading: "Empezar",
    navLabel: "Enlaces de cuenta",
    copyright: "Todos los derechos reservados.",
    links: {
      login: "Iniciar sesión",
      signup: "Registrarse",
    },
  },
  hero: {
    title: "Convierte tu API REST en un MCP en el que tu agente puede confiar",
    subtitle:
      "rest2mcp es un servicio alojado para mapear endpoints a herramientas curadas—no generación masiva automática. Importa desde curl, prueba en un playground y conecta vía el gateway.",
    ctaStart: "Registrarse",
    ctaDocs: "Cómo funciona",
  },
  problem: {
    title: "Un volcado no es un catálogo que un agente pueda usar",
    body: "Volcar cada operación OpenAPI en un servidor entrega al agente cientos de herramientas mal nombradas. El contexto se llena de ruido. El modelo elige la llamada incorrecta — y a veces una destructiva.",
    bullets: [
      {
        title: "Demasiadas herramientas",
        desc: "Los catálogos grandes diluyen el contexto y confunden qué llamada hacer.",
      },
      {
        title: "Nombres y esquemas pobres",
        desc: "Las etiquetas generadas rara vez coinciden con cómo un agente razona sobre una tarea.",
      },
      {
        title: "Riesgo por defecto",
        desc: "La exposición masiva aumenta la probabilidad de una llamada incorrecta o destructiva.",
      },
    ],
    leftoverLabel: "No pasa",
    passedLabel: "Pasa",
    closedLabel: "Sigue cerrado",
    contrast:
      "Menos herramientas. Nombres que un agente entiende. Esquemas para el trabajo.",
  },
  howItWorks: {
    title: "El mismo día",
    subtitle:
      "Crea un servidor, mapea una herramienta, pruébala, conecta un agente.",
    curlCommand: "curl -X GET",
    curlPath: "/v1/invoices/{id}",
    token: "Bearer •••••",
    steps: [
      {
        title: "Crea un servidor",
        desc: "Configura el origen HTTPS, los headers por defecto y las variables — incluidos los secretos cifrados.",
        artifact: "https://api.example.com",
      },
      {
        title: "Mapea una herramienta",
        desc: "Importa desde curl con vista previa, o define el método, la ruta, los params y el esquema de entrada a mano.",
        artifact: "get_invoice",
      },
      {
        title: "Prueba en el playground",
        desc: "Invoca la herramienta, lee el semáforo y revisa los logs redactados antes de publicarla.",
        artifact: "healthy",
      },
      {
        title: "Conecta tu agente",
        desc: "Pega la URL alojada /mcp/{serverId} y un token Bearer de un solo uso en cualquier cliente Streamable HTTP.",
        artifact: "/mcp/{serverId}",
      },
    ],
  },
  define: {
    title:
      "Haz que tu API REST hable con tu agente de IA en menos de 10 minutos.",
    beats: [
      {
        index: "01",
        label: "Eliges",
        method: "GET",
        artifact: "/v1/invoices/{id}",
        desc: "Importa un curl o elige un endpoint. Sin spec completa, sin setup largo.",
      },
      {
        index: "02",
        label: "Listo",
        artifact: "get_invoice",
        desc: "Le ponemos nombre y esquema. Tu agente ya sabe qué invocar.",
      },
      {
        index: "03",
        label: "Conectas",
        artifact: "/mcp/{serverId}",
        desc: "Copia la URL. Pégala en tu agente — ya puede llamar tu API.",
      },
    ],
  },
  session: {
    title: "Un agente lo construye. Otro lo pone a trabajar.",
    pickerLabel: "Elige un endpoint huérfano",
    buildHeader: "tu agente → rest2mcp",
    workLabel: "WORK",
    liveLabel: "live",
    thinkingLabel: "Pensando",
    toolLabel: "Ejecutó",
    composerHint: "Escribe a rest2mcp",
    composerWorkHint: "Escribe al especialista",
    cardTitle: "Fragmento de conexión",
    cardTransport: "Streamable HTTP",
    cardAuthLabel: "Authorization",
    guardNote:
      "protección de mutaciones — permite {method} en esta herramienta",
    playgroundLabel: "playground",
    handshakeCaption:
      "Pégalo una vez en Cursor, Claude Desktop o cualquier cliente Streamable HTTP.",
    origin: "https://api.example.com",
    serverUrl: "/mcp/srv_9f2c",
    cast: [
      {
        method: "GET",
        path: "/v1/webhooks",
        tool: "list_webhooks",
        schema: "{ }",
        specialist: "especialista en operaciones",
        buildUser:
          "No importes todo el recurso de webhooks. Solo necesito una herramienta que los liste y me diga cuáles fallan.",
        buildThink:
          "Una sola herramienta de lectura. Voy a mapear GET /v1/webhooks a list_webhooks con esquema vacío y correrla en el playground.",
        buildTool: "create_tool",
        buildToolDetail: "GET /v1/webhooks → list_webhooks { }",
        buildPlay: "list_webhooks() · healthy",
        buildReply:
          "list_webhooks está en el servidor. La conexión va abajo — pégala una vez.",
        workUser: "Lista nuestros webhooks y marca los que fallen.",
        workThink:
          "list_webhooks no pide argumentos. La llamo y leo failing del payload.",
        args: "{ }",
        result: '200 · { "webhooks": 3, "failing": 0 }',
        workReply: "Tres webhooks, todos healthy. Ninguno falla.",
      },
      {
        method: "POST",
        path: "/v1/events/{id}/replay",
        tool: "replay_event",
        schema: "{ id: string }",
        specialist: "especialista en operaciones",
        buildUser:
          "Se nos escapan entregas. Mapea POST /v1/events/{id}/replay a una sola herramienta. Deja las mutaciones bloqueadas hasta que yo las permita, y luego pruébala.",
        buildThink:
          "Es una mutación. Creo replay_event con id: string, dejo la protección puesta y lanzo el playground.",
        buildTool: "create_tool",
        buildToolDetail:
          "POST /v1/events/{id}/replay → replay_event { id: string }",
        buildPlay: 'replay_event({ "id": "evt_117" }) · healthy',
        buildReply:
          "replay_event está en el servidor. POST sigue bloqueado hasta que lo permitas. La conexión va abajo — pégala una vez.",
        workUser: "Repite el evento evt_117 — el webhook nunca llegó.",
        workThink: "replay_event pide un id. Lo llamo con evt_117.",
        args: '{ "id": "evt_117" }',
        result: '200 · { "status": "replayed", "delivered": true }',
        workReply: "evt_117 se repitió y se entregó.",
      },
      {
        method: "DELETE",
        path: "/v1/keys/{id}",
        tool: "revoke_key",
        schema: "{ id: string }",
        specialist: "especialista en seguridad",
        buildUser:
          "Necesito una herramienta justa para revocar una API key filtrada. Solo DELETE /v1/keys/{id} — no expongas el resto de keys. Protege la mutación.",
        buildThink:
          "Una herramienta destructiva. Mapeo revoke_key, dejo DELETE bloqueado hasta que opten, y la pruebo en el playground.",
        buildTool: "create_tool",
        buildToolDetail: "DELETE /v1/keys/{id} → revoke_key { id: string }",
        buildPlay: 'revoke_key({ "id": "key_32" }) · healthy',
        buildReply:
          "revoke_key está en el servidor. DELETE sigue bloqueado hasta que lo permitas. La conexión va abajo — pégala una vez.",
        workUser: "Revoca la clave key_32 — se filtró en una captura.",
        workThink: "revoke_key pide un id. Lo llamo con key_32.",
        args: '{ "id": "key_32" }',
        result: '200 · { "status": "revoked" }',
        workReply: "key_32 está revocada.",
      },
      {
        method: "GET",
        path: "/v1/users/{id}/settings",
        tool: "get_user_settings",
        schema: "{ id: string }",
        specialist: "especialista en soporte",
        buildUser:
          "Soporte pide todo el tiempo la configuración de un usuario. Dame GET /v1/users/{id}/settings como una herramienta nombrada como la pediría un agente.",
        buildThink:
          "Una lectura con un path param. Mapeo get_user_settings { id: string } y corro el playground.",
        buildTool: "create_tool",
        buildToolDetail:
          "GET /v1/users/{id}/settings → get_user_settings { id: string }",
        buildPlay: 'get_user_settings({ "id": "usr_209" }) · healthy',
        buildReply:
          "get_user_settings está en el servidor. La conexión va abajo — pégala una vez.",
        workUser: "Trae la configuración de usr_209.",
        workThink: "get_user_settings pide un id. Lo llamo con usr_209.",
        args: '{ "id": "usr_209" }',
        result: '200 · { "locale": "es", "theme": "light" }',
        workReply: "usr_209 está en locale es, theme light.",
      },
      {
        method: "POST",
        path: "/v1/invoices/{id}/void",
        tool: "void_invoice",
        schema: "{ id: string }",
        specialist: "especialista en facturación",
        buildUser:
          "Necesitamos anular facturas. No vuelques toda la API de billing — solo POST /v1/invoices/{id}/void. Deja las mutaciones bloqueadas hasta que yo las permita, y luego pruébala.",
        buildThink:
          "Una herramienta, no el catálogo de invoices. Mapeo ese POST a void_invoice, dejo la protección puesta y la corro en el playground.",
        buildTool: "create_tool",
        buildToolDetail:
          "POST /v1/invoices/{id}/void → void_invoice { id: string }",
        buildPlay: 'void_invoice({ "id": "inv_2041" }) · healthy',
        buildReply:
          "void_invoice está en el servidor. POST sigue bloqueado hasta que lo permitas. La conexión va abajo — pégala una vez.",
        workUser: "Anula la factura inv_2041 y confirma la nota de crédito.",
        workThink: "void_invoice pide un id. Lo llamo con inv_2041.",
        args: '{ "id": "inv_2041" }',
        result: '200 · { "status": "voided", "credit_note": "cn_881" }',
        workReply:
          "inv_2041 está anulada. Se emitió la nota de crédito cn_881.",
      },
      {
        method: "POST",
        path: "/v1/orders/{id}/cancel",
        tool: "cancel_order",
        schema: "{ id: string }",
        specialist: "especialista en soporte",
        buildUser:
          "Soporte necesita cancelar un pedido y avisar al cliente. Mapea POST /v1/orders/{id}/cancel. Protege la mutación. No traigas el resto de orders.",
        buildThink:
          "Una sola mutación con id. Creo cancel_order, dejo POST bloqueado y la pruebo.",
        buildTool: "create_tool",
        buildToolDetail:
          "POST /v1/orders/{id}/cancel → cancel_order { id: string }",
        buildPlay: 'cancel_order({ "id": "ord_552" }) · healthy',
        buildReply:
          "cancel_order está en el servidor. POST sigue bloqueado hasta que lo permitas. La conexión va abajo — pégala una vez.",
        workUser: "Cancela el pedido ord_552 y notifica al cliente.",
        workThink: "cancel_order pide un id. Lo llamo con ord_552.",
        args: '{ "id": "ord_552" }',
        result: '200 · { "status": "cancelled", "notified": true }',
        workReply: "ord_552 está cancelado y el cliente fue notificado.",
      },
    ],
  },
  features: {
    title: "Live",
    subtitle: "En la consola ahora.",
    items: [
      {
        title: "Importación curl con vista previa",
        desc: "Pega un comando curl, previsualiza la petición y marca campos antes de guardarla como herramienta.",
      },
      {
        title: "Params y esquemas de herramientas",
        desc: "Query, path, body y headers con esquemas de entrada tipados que un agente puede seguir.",
      },
      {
        title: "Variables y secretos",
        desc: "Variables de servidor con secretos cifrados — nunca devueltos en lecturas ni mostrados en logs.",
      },
      {
        title: "Gateway MCP alojado",
        desc: "Cada servidor obtiene una URL estable /mcp/{serverId} para conexiones de agentes.",
      },
      {
        title: "Playground y semáforo",
        desc: "Ejecuta herramientas en el navegador con señales healthy, unstable, failing, paused y draft.",
      },
      {
        title: "Logs de llamadas redactados",
        desc: "Historial paginado de peticiones con secretos eliminados de lo que ves.",
      },
      {
        title: "Protección de mutaciones",
        desc: "POST, PUT, PATCH y DELETE permanecen bloqueados en cada herramienta hasta que permitas que esa herramienta mute.",
      },
      {
        title: "Platform MCP",
        desc: "Crea y actualiza servidores desde un agente externo en /api/platform-mcp — los cambios se sincronizan con la GUI.",
      },
      {
        title: "Iconos personalizados",
        desc: "Sube un icono o quédate con el fallback automático.",
      },
    ],
  },
  workflows: {
    title: "Dos puertas",
    subtitle:
      "Trabaja en la GUI o desde un agente. Mismos servidores. Mismas herramientas.",
    join: "GUI web  |  Platform MCP",
    sync: "Cada cambio aparece en ambas.",
    gui: {
      title: "GUI web",
      desc: "Autoría visual cuando quieres la consola completa delante.",
      bullets: [
        "Importa curl y ajusta el mapeo",
        "Ejecuta el playground y lee el semáforo",
        "Gestiona variables, headers y configuración de mutaciones",
      ],
    },
    platformMcp: {
      title: "Platform MCP",
      desc: "Deja que un agente externo cree y actualice los mismos servidores en conversación.",
      bullets: [
        "Conéctate en /api/platform-mcp con tu token de agente",
        "Crea servidores, herramientas y variables desde el agente",
        "Ve cada cambio reflejado en la GUI",
      ],
    },
  },
  security: {
    title: "Cerrado",
    subtitle: "Hasta que lo abras.",
    bullets: [
      {
        title: "Secretos cifrados",
        desc: "Las variables secretas se cifran en reposo y se redactan en lecturas y logs.",
      },
      {
        title: "Allowlist SSRF",
        desc: "Las llamadas salientes solo llegan a hosts que permites — sin fetch a URLs arbitrarias.",
      },
      {
        title: "Protección de mutaciones",
        desc: "POST, PUT, PATCH y DELETE permanecen desactivados en cada herramienta hasta que optes por esa herramienta.",
      },
      {
        title: "Tokens de agente de un solo uso",
        desc: "Los tokens se muestran una vez al crearlos. Guárdalos en la config del agente.",
      },
      {
        title: "Aislamiento por cuenta",
        desc: "Servidores, herramientas, tokens y logs pertenecen solo a tu cuenta.",
      },
    ],
  },
  roadmap: {
    title: "Aún no",
    subtitle: "Etiquetado. No publicado.",
    statusLabels: {
      planned: "Planificado",
      exploring: "Explorando",
    },
    items: [
      {
        title: "Plantillas de recetas",
        desc: "Guarda y reutiliza configuraciones de servidor como plantillas con nombre.",
        status: "planned",
      },
      {
        title: "Marketplace de recetas",
        desc: "Comparte o descubre recetas comunitarias para patrones comunes de API.",
        status: "planned",
      },
      {
        title: "Importación OpenAPI",
        desc: "Importación masiva desde specs OpenAPI junto a curl y herramientas manuales.",
        status: "planned",
      },
      {
        title: "Conector on-prem",
        desc: "Un túnel o conector local para APIs que no pueden exponerse al gateway público.",
        status: "exploring",
      },
      {
        title: "Paquetes de skills",
        desc: "Empaqueta conjuntos curados de herramientas para flujos específicos de agentes.",
        status: "planned",
      },
      {
        title: "Herramientas multipart y archivos",
        desc: "Soporte de primera clase para subida de archivos y cuerpos multipart.",
        status: "exploring",
      },
    ],
  },
  audience: {
    title: "Para quién es",
    subtitle: "Un MCP cuidadoso, no un volcado de toda la API.",
    personas: [
      {
        title: "Consultor / implementador",
        desc: "Entrega integraciones MCP para clientes sin escribir ni alojar un proxy propio.",
      },
      {
        title: "Desarrollador con tu propia API",
        desc: "Expón un subconjunto cuidadoso de tu API REST a agentes que controlas.",
      },
      {
        title: "Power user de agentes",
        desc: "Cierra huecos en MCPs oficiales con herramientas que coinciden con cómo trabajas.",
      },
    ],
  },
  finalCta: {
    title: "Crea un servidor hoy",
    subtitle: "Mapea una herramienta. Copia una URL. Conecta un agente.",
    cta: "Registrarse",
  },
  faq: {
    title: "Antes de conectar",
    items: [
      {
        q: "¿Necesito una spec OpenAPI?",
        a: "No. Empieza con curl o una herramienta a mano. La importación OpenAPI está planificada.",
      },
      {
        q: "¿rest2mcp reemplaza MCPs oficiales?",
        a: "No. Usa MCPs oficiales donde existan; rest2mcp cubre los huecos.",
      },
      {
        q: "¿Puedo conectar software local u on-prem?",
        a: "Hoy el gateway llama a endpoints HTTPS públicos. Un conector on-prem está en exploración.",
      },
      {
        q: "¿Cuántas herramientas puede tener un servidor?",
        a: "50. Un tope duro para que los catálogos sigan siendo útiles para agentes.",
      },
      {
        q: "¿Qué clientes MCP son compatibles?",
        a: "Cualquier cliente Streamable HTTP con Bearer — Cursor, Claude Desktop y hosts compatibles.",
      },
      {
        q: "¿Qué pasa cuando pauso un servidor?",
        a: "El gateway rechaza las llamadas hasta que lo reanudes. Los agentes pueden seguir conectados.",
      },
    ],
  },
} as const;
