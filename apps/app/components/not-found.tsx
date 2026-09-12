import { useTranslations } from "@/i18n/use-translations";
import { Button } from "@repo/ui";
import { Link } from "@tanstack/react-router";

export function NotFound() {
  const { t } = useTranslations();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center p-6">
      <div className="mx-auto max-w-md text-center">
        <h1 className="mb-2 text-4xl font-bold">{t.errors.notFound.code}</h1>
        <p className="mb-6 text-muted-foreground">
          {t.errors.notFound.message}
        </p>
        <Button asChild>
          <Link to="/">{t.errors.notFound.goHome}</Link>
        </Button>
      </div>
    </div>
  );
}
