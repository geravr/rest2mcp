import { BrandLogo } from "@/components/brand-logo";
import { useTranslations } from "@/i18n/use-translations";
import { useSessionQuery } from "@/lib/queries/session";
import { useIsMobile } from "@repo/ui";
import { Link } from "@tanstack/react-router";
import { topNavItems } from "./constants";
import { MobileDrawerTrigger } from "./mobile-drawer";
import { TopbarNav } from "./topbar-nav";
import { TopbarUserMenu } from "./topbar-user-menu";

export function Topbar() {
  const { t } = useTranslations();
  const isMobile = useIsMobile();
  const { data: session } = useSessionQuery();
  const user = session?.user;

  if (isMobile) {
    return (
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-md">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <Link to="/" className="min-w-0 shrink-0">
            <BrandLogo
              alt={t.layout.topbar.logoAlt}
              className="h-8 w-auto object-contain"
            />
          </Link>

          <MobileDrawerTrigger />
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-20 grid h-16 grid-cols-[1fr_auto_1fr] items-center border-b border-border bg-background/95 backdrop-blur-md px-4 md:px-6">
      <Link to="/" className="shrink-0 justify-self-start">
        <BrandLogo
          alt={t.layout.topbar.logoAlt}
          className="h-10 w-auto object-contain"
        />
      </Link>

      <div className="justify-self-center">
        <TopbarNav items={topNavItems} />
      </div>

      <div className="justify-self-end flex items-center gap-2">
        <TopbarUserMenu user={user} />
      </div>
    </header>
  );
}
