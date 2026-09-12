import { useTranslations } from "@/i18n/use-translations";
import { cn } from "@repo/ui";
import { Link, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";

interface AdminSidebarNavItem {
  icon: LucideIcon;
  labelKey: keyof ReturnType<
    typeof useTranslations
  >["t"]["admin"]["layout"]["nav"];
  to: string;
}

interface AdminSidebarNavProps {
  items: readonly AdminSidebarNavItem[];
  onNavigate?: () => void;
}

export function AdminSidebarNav({ items, onNavigate }: AdminSidebarNavProps) {
  const { t } = useTranslations();
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  return (
    <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
      {items.map((item) => {
        const isActive =
          item.to === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(item.to);

        return (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-200",
              isActive
                ? "bg-primary/10 font-semibold text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            onClick={onNavigate}
          >
            <item.icon className="h-4 w-4 text-primary transition-colors group-hover:text-primary" />
            <span>{t.admin.layout.nav[item.labelKey]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
