import { en } from "./locales/en";
import { es } from "./locales/es";
import type { Widened } from "./schema";

export type Locale = "en" | "es";

export type UI = Widened<typeof en>;

const ui: Record<Locale, UI> = { en, es };

export function getTranslations(locale: string | undefined): UI {
  const l = (locale ?? "en") as Locale;
  return ui[l] ?? ui.en;
}
