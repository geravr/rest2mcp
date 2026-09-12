import { enEmailCopy, type EmailCopy } from "./locales/en.js";
import { esEmailCopy } from "./locales/es.js";

export type EmailLocale = "en" | "es";

export function getEmailCopy(locale: string | undefined): EmailCopy {
  return locale === "es" ? esEmailCopy : enEmailCopy;
}

export { enEmailCopy, esEmailCopy };
export type { EmailCopy };
