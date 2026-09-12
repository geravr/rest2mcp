export const en = {
  meta: {
    title: "Charro Stack",
    description:
      "Charro Digital's internal Bun-based monorepo template for building modern SaaS applications.",
  },
  header: {
    logoAlt: "Charro Stack",
    skipToContent: "Skip to content",
    login: "Log in",
    signup: "Sign up",
    langSwitcher: {
      ariaLabel: "Change language",
      en: "EN",
      es: "ES",
      enAriaLabel: "English",
      esAriaLabel: "Español",
    },
  },
  footer: {
    tagline: "Charro Digital · internal stack template",
    description:
      "A monorepo with authentication, a type-safe API, storage, and React Email. Clone and rename for your next product.",
    startHeading: "Get started",
    navLabel: "Account links",
    copyright: "All rights reserved.",
    links: {
      login: "Log in",
      signup: "Sign up",
    },
  },
  hero: {
    title: "Charro Digital's stack for type-safe SaaS",
    subtitle:
      "Charro Stack is our internal Bun monorepo: single-user email OTP auth, Hono + tRPC, Drizzle on PostgreSQL, S3 uploads, and a static marketing site.",
    ctaStart: "Sign up",
    ctaDocs: "See what's included",
  },
  features: {
    title: "What's included",
    subtitle:
      "The template ships these pieces wired together. Add your product on top.",
    items: [
      {
        title: "Secure Single-User Auth",
        desc: "Email OTP sign-in, sessions, and platform admin invites via Better Auth.",
      },
      {
        title: "Type-Safe tRPC & Hono",
        desc: "End-to-end type safety between your frontend React SPA and Hono API. No manual sync required.",
      },
      {
        title: "Drizzle ORM & PostgreSQL",
        desc: "Clean database schema, migrations management, and seed scripts ready for production.",
      },
      {
        title: "S3 Storage & React Email",
        desc: "File upload integration ready for any S3-compatible storage and custom email template builder.",
      },
    ],
  },
  techStack: {
    title: "Stack",
    subtitle: "The workspace uses these libraries. Swap any of them as needed.",
    items: [
      {
        name: "Bun",
        desc: "Fast all-in-one JavaScript/TypeScript runtime & package manager.",
      },
      { name: "Hono", desc: "Ultrafast web framework for the API layer." },
      {
        name: "tRPC",
        desc: "End-to-end type safety without resolvers or code generation.",
      },
      {
        name: "React 19",
        desc: "The latest React version for building standard SPA interfaces.",
      },
      {
        name: "Better Auth",
        desc: "Complete authentication with email OTP, sessions, and platform roles.",
      },
      {
        name: "Drizzle ORM",
        desc: "TypeScript-first ORM for writing type-safe SQL queries.",
      },
    ],
  },
  architecture: {
    title: "Repository layout",
    subtitle:
      "Workspaces stay separate: API, SPA, marketing site, email templates, shared UI, and the database.",
    bullets: [
      {
        title: "tRPC Router / Hono Handlers",
        desc: "Validates inputs and directs execution to modular Services.",
      },
      {
        title: "Decoupled Business Services",
        desc: "State and logic flows are isolated for clean unit testing.",
      },
      {
        title: "TypeScript-First ORM",
        desc: "Type-safety goes all the way down to your queries and schema definitions.",
      },
    ],
    structureLabel: "// Project Directory Structure",
    structureCode: `apps/
  api/         # Hono + tRPC backend on Bun
  app/         # React 19 SPA built with Vite
  web/         # Astro static marketing site
  email/       # React Email templates
packages/
  core/        # Domain validators and config schemas
  ui/          # Tailwind CSS v4 shared components
db/            # Drizzle schema, migrations & seed scripts`,
  },
  finalCta: {
    title: "Start from Charro Stack",
    subtitle:
      "Clone the repo, run bun rename for your product name, and replace this site with your own.",
    cta: "Sign up",
  },
  faq: {
    title: "Frequently Asked Questions",
    items: [
      {
        q: "What is Charro Stack?",
        a: "Charro Stack is Charro Digital's internal monorepo template for developers who want a solid architectural foundation for SaaS products.",
      },
      {
        q: "Does it support user accounts?",
        a: "Yes. It integrates Better Auth for secure registration, email OTP sign-in, and single-user accounts.",
      },
      {
        q: "What database does it use?",
        a: "It uses PostgreSQL. The database is accessed via Drizzle ORM, with full support for migrations and seeding.",
      },
    ],
  },
} as const;
