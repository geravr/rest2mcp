export const es = {
  meta: {
    title: "rest2mcp — estudio REST a MCP",
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
    tagline: "rest2mcp · estudio REST a MCP",
    description:
      "Construye herramientas MCP intencionales desde tus APIs, prueba en un playground y conecta cualquier cliente Streamable HTTP. Construido con un stack web moderno.",
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
      "rest2mcp es un estudio para mapear endpoints a herramientas curadas—no generación masiva automática. Importa desde curl, prueba en un playground y conecta vía un gateway alojado.",
    ctaStart: "Registrarse",
    ctaDocs: "Cómo funciona",
  },
  problem: {
    title: "Los catálogos MCP auto-generados rompen a los agentes",
    body: "Volcar cada operación OpenAPI en un servidor da a los agentes cientos de herramientas mal nombradas. Desperdician tokens, eligen la llamada incorrecta y a veces disparan mutaciones destructivas.",
    bullets: [
      {
        title: "Demasiadas herramientas",
        desc: "Los catálogos grandes diluyen el contexto y confunden la selección del modelo.",
      },
      {
        title: "Nombres y esquemas pobres",
        desc: "Las etiquetas generadas rara vez coinciden con cómo razonan los agentes sobre las tareas.",
      },
      {
        title: "Riesgo por defecto",
        desc: "La exposición masiva aumenta la probabilidad de llamadas incorrectas o destructivas.",
      },
    ],
    contrast:
      "rest2mcp empieza con intención: menos herramientas, nombres claros y esquemas diseñados para el éxito del agente.",
  },
  howItWorks: {
    title: "Cómo funciona",
    subtitle: "Cuatro pasos de la API al MCP listo para agentes.",
    steps: [
      {
        title: "Crea un servidor",
        desc: "Configura tu URL base, headers por defecto y variables—incluyendo secretos cifrados.",
      },
      {
        title: "Mapea herramientas",
        desc: "Importa desde curl con vista previa o define herramientas manualmente con params y esquemas de entrada.",
      },
      {
        title: "Prueba en el playground",
        desc: "Ejecuta llamadas con semáforo, revisa logs redactados y ajusta antes de publicar.",
      },
      {
        title: "Conecta tu agente",
        desc: "Usa tu URL MCP alojada y un token de agente de un solo uso con Streamable HTTP.",
      },
    ],
  },
  features: {
    title: "Disponible hoy",
    subtitle:
      "Capacidades disponibles en el estudio ahora—no promesas del roadmap.",
    items: [
      {
        title: "Importación curl con vista previa",
        desc: "Pega un comando curl, previsualiza la petición y marca campos antes de guardar como herramienta.",
      },
      {
        title: "Params y esquemas de herramientas",
        desc: "Define query, path, body y headers con esquemas de entrada tipados que los agentes pueden seguir.",
      },
      {
        title: "Variables y secretos",
        desc: "Almacena variables de servidor con manejo cifrado de secretos—nunca devueltos en lecturas ni logs.",
      },
      {
        title: "Gateway MCP alojado",
        desc: "Cada servidor obtiene una URL estable /mcp/{serverId} para conexiones de agentes.",
      },
      {
        title: "Playground y semáforo",
        desc: "Ejecuta herramientas en el navegador con señales claras de éxito, advertencia y error.",
      },
      {
        title: "Logs de llamadas redactados",
        desc: "Revisa el historial de peticiones con secretos eliminados de los logs mostrados.",
      },
      {
        title: "Protección de mutaciones",
        desc: "POST, PUT, PATCH y DELETE permanecen bloqueados en cada herramienta hasta que permitas mutaciones para esa herramienta.",
      },
      {
        title: "Platform MCP",
        desc: "Autoriza servidores desde un agente externo vía /api/platform-mcp—los cambios se sincronizan con la GUI.",
      },
      {
        title: "Iconos personalizados",
        desc: "Sube un icono o usa un fallback auto-generado para cada servidor.",
      },
    ],
  },
  workflows: {
    title: "Dos formas de construir",
    subtitle:
      "Usa la GUI o conduce el estudio desde tu agente—mismos servidores, mismas herramientas.",
    gui: {
      title: "GUI web",
      desc: "Autoría visual para consultores y desarrolladores que quieren control total.",
      bullets: [
        "Importa curl y ajusta mapeos de herramientas",
        "Ejecuta el playground y lee resultados del semáforo",
        "Gestiona variables, headers y configuración de mutaciones",
      ],
    },
    platformMcp: {
      title: "Platform MCP",
      desc: "Deja que un agente externo cree y actualice servidores en conversación.",
      bullets: [
        "Conéctate vía /api/platform-mcp con tu token de agente",
        "Crea servidores, herramientas y variables programáticamente",
        "Ve cada cambio reflejado al instante en la GUI",
      ],
    },
  },
  security: {
    title: "Diseñado para confianza",
    subtitle: "Límites de seguridad que protegen tus claves de API y agentes.",
    bullets: [
      {
        title: "Secretos cifrados",
        desc: "Las variables secretas se cifran en reposo y se redactan en lecturas y logs.",
      },
      {
        title: "Allowlist SSRF",
        desc: "Las peticiones salientes solo llegan a hosts que permites—sin fetch a URLs arbitrarias.",
      },
      {
        title: "Protección de mutaciones",
        desc: "POST, PUT, PATCH y DELETE permanecen deshabilitados en cada herramienta hasta que optes por herramienta.",
      },
      {
        title: "Tokens de agente de un solo uso",
        desc: "Los tokens se muestran una vez al crearlos—guárdalos en la config de tu agente.",
      },
      {
        title: "Aislamiento por usuario",
        desc: "Servidores, herramientas y logs pertenecen solo a tu cuenta.",
      },
    ],
  },
  roadmap: {
    title: "Roadmap",
    subtitle:
      "Lo que exploramos a continuación—claramente etiquetado, aún no disponible.",
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
      "Equipos e individuos que necesitan herramientas MCP curadas, no volcados masivos de API.",
    personas: [
      {
        title: "Consultor / implementador",
        desc: "Entrega integraciones MCP para clientes sin mantener código proxy personalizado.",
      },
      {
        title: "Desarrollador con tu propia API",
        desc: "Expón un subconjunto cuidadoso de tu API REST a agentes que controlas.",
      },
      {
        title: "Power user de agentes",
        desc: "Cierra huecos en MCPs oficiales con herramientas adaptadas a cómo trabajas realmente.",
      },
    ],
  },
  finalCta: {
    title: "Empieza a construir tu MCP",
    subtitle:
      "Regístrate, crea un servidor y conecta tu primer agente en minutos.",
    cta: "Registrarse",
  },
  faq: {
    title: "Preguntas frecuentes",
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
