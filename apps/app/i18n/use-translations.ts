import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEffect } from "react";
import { getTranslations, type Locale, type UI } from "./index";

interface LangState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const STORAGE_KEY = "saas-lang";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function syncLangCookie(locale: Locale) {
  document.cookie = `${STORAGE_KEY}=${locale}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

function detectLocale(): Locale {
  try {
    const lang = navigator.language ?? "";
    if (lang.startsWith("es")) return "es";
  } catch {
    // guard against SSR or non-browser environments
  }
  return "en";
}

const useLangStore = create<LangState>()(
  persist(
    (set) => ({
      locale: detectLocale(),
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: STORAGE_KEY,
    },
  ),
);

export function useTranslations(): {
  t: UI;
  locale: Locale;
  setLocale: (locale: Locale) => void;
} {
  const { locale, setLocale } = useLangStore();
  useEffect(() => {
    document.documentElement.lang = locale;
    syncLangCookie(locale);
  }, [locale]);
  const t = getTranslations(locale);
  return { t, locale, setLocale };
}
