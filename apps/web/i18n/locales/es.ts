export const es = {
  meta: {
    title: "rest2mcp",
    description:
      "Plantilla monorepo interna de Charro Digital basada en Bun para construir aplicaciones SaaS modernas.",
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
    tagline: "Charro Digital · plantilla interna de stack",
    description:
      "Un monorepo con autenticación, API type-safe, almacenamiento y React Email. Clónalo y renómbralo para tu próximo producto.",
    startHeading: "Empezar",
    navLabel: "Enlaces de cuenta",
    copyright: "Todos los derechos reservados.",
    links: {
      login: "Iniciar sesión",
      signup: "Registrarse",
    },
  },
  hero: {
    title: "El stack de Charro Digital para SaaS type-safe",
    subtitle:
      "rest2mcp es nuestro monorepo interno en Bun: auth con OTP por email, API Hono + tRPC, Drizzle sobre PostgreSQL, subidas S3 y un sitio de marketing estático.",
    ctaStart: "Registrarse",
    ctaDocs: "Ver qué incluye",
  },
  features: {
    title: "Qué incluye",
    subtitle:
      "La plantilla entrega estas piezas ya conectadas. Añade tu producto encima.",
    items: [
      {
        title: "Autenticación de usuario único",
        desc: "Inicio de sesión con OTP por email, sesiones e invitaciones de admin de plataforma con Better Auth.",
      },
      {
        title: "Hono y tRPC Type-Safe",
        desc: "Type-safety de extremo a extremo entre tu frontend SPA (React) y la API (Hono). Sin sincronizaciones manuales.",
      },
      {
        title: "Drizzle ORM y PostgreSQL",
        desc: "Esquemas de base de datos limpios, gestión de migraciones y scripts de semilla listos para producción.",
      },
      {
        title: "Almacenamiento S3 y React Email",
        desc: "Integración de subida de archivos para cualquier almacenamiento compatible con S3 y constructor de correos.",
      },
    ],
  },
  techStack: {
    title: "Stack",
    subtitle: "El workspace usa estas librerías. Cámbialas si lo necesitas.",
    items: [
      {
        name: "Bun",
        desc: "Runtime, gestor de paquetes y herramientas de JS/TS ultra-rápido.",
      },
      {
        name: "Hono",
        desc: "Framework web extremadamente rápido para la capa de API.",
      },
      {
        name: "tRPC",
        desc: "Type-safety de extremo a extremo sin necesidad de compiladores ni generadores de código.",
      },
      {
        name: "React 19",
        desc: "La última versión de React para interfaces SPA dinámicas y estéticas.",
      },
      {
        name: "Better Auth",
        desc: "Autenticación completa con OTP por email, sesiones y roles de plataforma.",
      },
      {
        name: "Drizzle ORM",
        desc: "ORM moderno centrado en TypeScript para consultas SQL type-safe.",
      },
    ],
  },
  architecture: {
    title: "Estructura del repositorio",
    subtitle:
      "Los workspaces se mantienen separados: API, SPA, sitio de marketing, emails, UI compartida y base de datos.",
    bullets: [
      {
        title: "tRPC Router / Controladores de Hono",
        desc: "Valida las entradas y dirige la ejecución a Servicios modulares.",
      },
      {
        title: "Servicios de Negocio Desacoplados",
        desc: "Los flujos de estado y lógica están aislados para pruebas unitarias limpias.",
      },
      {
        title: "ORM Centrado en TypeScript",
        desc: "La seguridad de tipos llega hasta tus consultas y definiciones de esquemas.",
      },
    ],
    structureLabel: "// Estructura de Directorios del Proyecto",
    structureCode: `apps/
  api/         # Backend Hono + tRPC en Bun
  app/         # SPA React 19 construida con Vite
  web/         # Sitio de marketing estático Astro
  email/       # Plantillas de React Email
packages/
  core/        # Validadores de dominio y esquemas
  ui/          # Componentes compartidos de Tailwind v4
db/            # Esquema Drizzle, migraciones y semillas`,
  },
  finalCta: {
    title: "Empieza desde rest2mcp",
    subtitle:
      "Clona el repo, ejecuta bun rename con el nombre de tu producto y sustituye este sitio por el tuyo.",
    cta: "Registrarse",
  },
  faq: {
    title: "Preguntas Frecuentes",
    items: [
      {
        q: "¿Qué es rest2mcp?",
        a: "rest2mcp es la plantilla monorepo interna de Charro Digital para desarrolladores que quieren una base arquitectónica sólida para productos SaaS.",
      },
      {
        q: "¿Soporta cuentas de usuario?",
        a: "Sí. Integra Better Auth para registro seguro, inicio de sesión con OTP por email y cuentas de usuario único.",
      },
      {
        q: "¿Qué base de datos utiliza?",
        a: "Utiliza PostgreSQL. La base de datos se maneja a través de Drizzle ORM, con soporte total para migraciones y semillas.",
      },
    ],
  },
} as const;
