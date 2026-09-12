import { en } from "./locales/en";
import { es } from "./locales/es";

export type Locale = "en" | "es";

// Widen all leaf string literals to `string` so both locales can satisfy the
// same structural shape without clashing on their specific literal values.
type Widened<T> = T extends readonly (infer U)[]
  ? readonly Widened<U>[]
  : T extends object
    ? { readonly [K in keyof T]: Widened<T[K]> }
    : T extends string
      ? string
      : T;

export type UI = Widened<typeof en>;

const ui: Record<Locale, UI> = { en, es };

export function getTranslations(locale: string | undefined): UI {
  const l = (locale ?? "en") as Locale;
  return ui[l] ?? ui.en;
}
