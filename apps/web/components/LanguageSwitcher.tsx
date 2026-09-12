interface Props {
  /** Current locale — "en" or "es". */
  locale: string;
  labels: {
    ariaLabel: string;
    en: string;
    es: string;
    enAriaLabel: string;
    esAriaLabel: string;
  };
}

const LANG_COOKIE = "saas-lang";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function setLangCookie(value: "en" | "es") {
  document.cookie = `${LANG_COOKIE}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function LanguageSwitcher({ locale, labels }: Props) {
  const isEn = locale !== "es";

  return (
    <nav
      className="flex rounded-md border border-border"
      aria-label={labels.ariaLabel}
    >
      {isEn ? (
        <span
          className="rounded-l-md bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground"
          aria-current="page"
        >
          {labels.en}
        </span>
      ) : (
        <a
          href="/"
          className="rounded-l-md px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={labels.enAriaLabel}
          onClick={() => setLangCookie("en")}
        >
          {labels.en}
        </a>
      )}
      {!isEn ? (
        <span
          className="rounded-r-md bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground"
          aria-current="page"
        >
          {labels.es}
        </span>
      ) : (
        <a
          href="/es/"
          className="rounded-r-md px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={labels.esAriaLabel}
          onClick={() => setLangCookie("es")}
        >
          {labels.es}
        </a>
      )}
    </nav>
  );
}
