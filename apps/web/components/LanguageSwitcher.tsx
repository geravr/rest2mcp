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
    <nav className="page-lang" aria-label={labels.ariaLabel}>
      {isEn ? (
        <span className="page-lang-current" aria-current="page">
          {labels.en}
        </span>
      ) : (
        <a
          href="/"
          className="page-lang-link"
          aria-label={labels.enAriaLabel}
          onClick={() => setLangCookie("en")}
        >
          {labels.en}
        </a>
      )}
      {!isEn ? (
        <span className="page-lang-current" aria-current="page">
          {labels.es}
        </span>
      ) : (
        <a
          href="/es/"
          className="page-lang-link"
          aria-label={labels.esAriaLabel}
          onClick={() => setLangCookie("es")}
        >
          {labels.es}
        </a>
      )}
    </nav>
  );
}
