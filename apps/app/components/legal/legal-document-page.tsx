import { useTranslations } from "@/i18n/use-translations";
import { Alert, AlertDescription } from "@repo/ui";
import { Link } from "@tanstack/react-router";

export function LegalDocumentPage({
  title,
  sections,
}: {
  title: string;
  sections: readonly string[];
}) {
  const { t } = useTranslations();

  return (
    <div className="min-h-svh bg-muted px-6 py-10 md:px-10">
      <article className="mx-auto w-full max-w-2xl space-y-6">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <Alert>
            <AlertDescription>{t.legal.disclaimer}</AlertDescription>
          </Alert>
        </div>

        <div className="space-y-4 text-sm leading-7 text-foreground">
          {sections.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>

        <p className="pt-2 text-sm text-muted-foreground">
          <Link
            to="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t.legal.backToLogin}
          </Link>
        </p>
      </article>
    </div>
  );
}
