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
      "rest2mcp empieza con intención: menos herramientas, nombres que un agente puede usar, esquemas hechos para el trabajo.",
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
  session: {
    title: "Un agente lo construye. Otro lo pone a trabajar.",
    pickerLabel: "Elige un endpoint huérfano",
    buildHeader: "BUILD · tu agente → rest2mcp",
    workLabel: "WORK",
    liveLabel: "live",
    guardNote: "protección de mutaciones — permite {method} en esta herramienta",
    playgroundLabel: "playground",
    handshakeCaption: "el handshake — pégalo una vez",
    origin: "https://api.example.com",
    serverUrl: "/mcp/srv_9f2c",
    cast: [
      {
        method: "GET",
        path: "/v1/webhooks",
        tool: "list_webhooks",
        schema: "{ }",
        specialist: "especialista en operaciones",
        task: "Lista nuestros webhooks y marca los que fallen.",
        args: "{ }",
        result: "200 · { \"webhooks\": 3, \"failing\": 0 }",
        done: "Listo — 3 webhooks, todos healthy.",
      },
      {
        method: "POST",
        path: "/v1/events/{id}/replay",
        tool: "replay_event",
        schema: "{ id: string }",
        specialist: "especialista en operaciones",
        task: "Repite el evento evt_117 — el webhook nunca llegó.",
        args: "{ \"id\": \"evt_117\" }",
        result: "200 · { \"status\": \"replayed\", \"delivered\": true }",
        done: "Listo — evt_117 repetido y entregado.",
      },
      {
        method: "DELETE",
        path: "/v1/keys/{id}",
        tool: "revoke_key",
        schema: "{ id: string }",
        specialist: "especialista en seguridad",
        task: "Revoca la clave key_32 — se filtró en una captura.",
        args: "{ \"id\": \"key_32\" }",
        result: "200 · { \"status\": \"revoked\" }",
        done: "Listo — key_32 revocada.",
      },
      {
        method: "GET",
        path: "/v1/users/{id}/settings",
        tool: "get_user_settings",
        schema: "{ id: string }",
        specialist: "especialista en soporte",
        task: "Trae la configuración de usr_209.",
        args: "{ \"id\": \"usr_209\" }",
        result: "200 · { \"locale\": \"es\", \"theme\": \"light\" }",
        done: "Listo — configuración de usr_209 obtenida.",
      },
      {
        method: "POST",
        path: "/v1/invoices/{id}/void",
        tool: "void_invoice",
        schema: "{ id: string }",
        specialist: "especialista en facturación",
        task: "Anula la factura inv_2041 y confirma la nota de crédito.",
        args: "{ \"id\": \"inv_2041\" }",
        result: "200 · { \"status\": \"voided\", \"credit_note\": \"cn_881\" }",
        done: "Listo — inv_2041 anulada, nota de crédito cn_881 emitida.",
      },
      {
        method: "POST",
        path: "/v1/orders/{id}/cancel",
        tool: "cancel_order",
        schema: "{ id: string }",
        specialist: "especialista en soporte",
        task: "Cancela el pedido ord_552 y notifica al cliente.",
        args: "{ \"id\": \"ord_552\" }",
        result: "200 · { \"status\": \"cancelled\", \"notified\": true }",
        done: "Listo — ord_552 cancelado, cliente notificado.",
      },
    ],
  },
  features: {
    title: "Disponible en la consola",
    subtitle: "Lo que puedes usar hoy — no un roadmap.",
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
    title: "Lo que permanece cerrado",
    subtitle: "La abertura se queda estrecha hasta que la abres.",
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
    subtitle: "Lo que sigue — etiquetado, no publicado.",
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
    subtitle:
      "Quienes necesitan un MCP cuidadoso, no un volcado de toda la API.",
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
        a: "No. Empieza hoy con importación curl o definiciones manuales de herramientas. La importación OpenAPI está en el roadmap.",
      },
      {
        q: "¿rest2mcp reemplaza MCPs oficiales?",
        a: "Normalmente no—los complementa. Usa MCPs oficiales donde existan y rest2mcp para APIs y flujos que no cubren.",
      },
      {
        q: "¿Puedo conectar software local u on-prem?",
        a: "Hoy el gateway alojado llama a endpoints HTTPS públicos que configures. Un conector on-prem está en el roadmap para APIs detrás de un firewall.",
      },
      {
        q: "¿Cuántas herramientas puede tener un servidor?",
        a: "Cada servidor admite hasta 50 herramientas—un límite deliberado que mantiene catálogos amigables para agentes.",
      },
      {
        q: "¿Qué clientes MCP son compatibles?",
        a: "Cualquier cliente que hable Streamable HTTP con autenticación Bearer. Pega tu URL de gateway y token de agente en Cursor, Claude Desktop u hosts compatibles.",
      },
      {
        q: "¿Qué pasa cuando pauso un servidor?",
        a: "Un servidor pausado rechaza la ejecución de herramientas a través del gateway y muestra un semáforo en pausa hasta que lo reanudes. Los agentes pueden seguir conectados, pero las llamadas fallarán hasta que el servidor vuelva a estar activo.",
      },
    ],
  },
} as const;
