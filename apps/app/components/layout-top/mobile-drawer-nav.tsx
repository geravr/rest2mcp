import { useTranslations } from "@/i18n/use-translations";
import { cn } from "@repo/ui";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Home, Server, type LucideIcon } from "lucide-react";
import type { TopNavItem } from "./constants";

const navIcons: Partial<Record<TopNavItem["labelKey"], LucideIcon>> = {
  home: Home,
  servers: Server,
};

interface MobileDrawerNavProps {
  items: readonly TopNavItem[];
  onNavigate?: () => void;
}

export function MobileDrawerNav({ items, onNavigate }: MobileDrawerNavProps) {
  const { t } = useTranslations();

  return (
    <nav
      aria-label={t.layout.topbar.primaryNavigation}
      className="flex flex-col gap-2 px-4 py-4"
    >
      {items.map((item) => {
        const Icon = navIcons[item.labelKey] ?? Home;

        return (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={item.exact ? { exact: true } : undefined}
            onClick={onNavigate}
            className={cn(
              "group flex items-center gap-3 rounded-2xl border border-border/70 bg-muted/25 p-3.5 transition-colors hover:border-border hover:bg-muted/50",
            )}
            activeProps={{
              className:
                "!border-primary/25 !bg-primary/10 hover:!bg-primary/10 [&_[data-nav-icon]]:!bg-primary [&_[data-nav-icon]]:!text-primary-foreground [&_[data-nav-icon]]:!ring-primary/20 [&_[data-nav-label]]:!text-primary [&_[data-nav-chevron]]:!text-primary",
            }}
          >
            <span
              data-nav-icon
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground shadow-sm ring-1 ring-border/60 transition-colors group-hover:text-foreground"
            >
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span
                data-nav-label
                className="block text-sm font-semibold text-foreground"
              >
                {t.layout.nav[item.labelKey]}
              </span>
            </span>
            <ChevronRight
              data-nav-chevron
              className="h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
            />
          </Link>
        );
      })}
    </nav>
  );
}
