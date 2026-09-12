import { BrandIcon } from "@/components/brand-icon";
import { useTranslations } from "@/i18n/use-translations";
import { Card, CardContent } from "@repo/ui";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

interface AuthScreenShellProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function AuthScreenShell({
  title,
  description,
  children,
}: AuthScreenShellProps) {
  const { t } = useTranslations();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted px-6 py-10">
      <div className="w-full max-w-[24rem] space-y-6">
        <div className="flex flex-col items-center space-y-4 text-center">
          <Link
            to="/"
            aria-label={t.auth.goToHomepage}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card sm:h-14 sm:w-14"
          >
            <BrandIcon className="h-10 w-10 sm:h-12 sm:w-12" />
          </Link>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-6 sm:p-7">{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}
