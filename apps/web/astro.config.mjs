import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

// Load root .env variables for the Astro build process (side-effect: populates process.env)
loadEnv(process.env.NODE_ENV || "development", "../..", "");

const site = process.env.PUBLIC_APP_ORIGIN || "http://localhost:4321";

export default defineConfig({
  site,
  srcDir: ".",
  publicDir: "./public",
  outDir: "./dist",
  output: "static",
  integrations: [react()],
  i18n: {
    defaultLocale: "en",
    locales: ["en", "es"],
    routing: { prefixDefaultLocale: false },
  },
  devToolbar: {
    enabled: false,
  },
  vite: {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("../../packages/ui", import.meta.url)),
      },
    },
  },
});
