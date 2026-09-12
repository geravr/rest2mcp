import { useTranslations } from "@/i18n/use-translations";
import { Button, cn } from "@repo/ui";

export function LocaleSwitcher() {
  const { t, locale, setLocale } = useTranslations();

  return (
    <div
      className="inline-flex items-center rounded-full border border-border bg-muted/50 p-1"
      aria-label={t.layout.topbar.languageSwitcher}
      role="group"
    >
      <Button
        type="button"
        variant={locale === "en" ? "secondary" : "ghost"}
        size="sm"
        className={cn(
          "h-8 rounded-full px-3 text-xs font-semibold",
          locale === "en" && "shadow-sm",
        )}
        aria-pressed={locale === "en"}
        aria-label={t.layout.topbar.languageEnglish}
        onClick={() => setLocale("en")}
      >
        EN
      </Button>
      <Button
        type="button"
        variant={locale === "es" ? "secondary" : "ghost"}
        size="sm"
        className={cn(
          "h-8 rounded-full px-3 text-xs font-semibold",
          locale === "es" && "shadow-sm",
        )}
        aria-pressed={locale === "es"}
        aria-label={t.layout.topbar.languageSpanish}
        onClick={() => setLocale("es")}
      >
        ES
      </Button>
    </div>
  );
}
