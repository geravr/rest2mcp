import { useTranslations } from "@/i18n/use-translations";
import { cn } from "@repo/ui";
import { Link } from "@tanstack/react-router";
import type { TopNavItem } from "./constants";

interface TopbarNavProps {
  items: readonly TopNavItem[];
  onNavigate?: () => void;
}

export function TopbarNav({ items, onNavigate }: TopbarNavProps) {
  const { t } = useTranslations();

  return (
    <nav className="flex items-center gap-6">
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeOptions={item.exact ? { exact: true } : undefined}
          className={cn(
            "text-sm text-muted-foreground transition-colors hover:text-foreground",
          )}
          activeProps={{
            className: "!text-foreground",
          }}
          onClick={onNavigate}
        >
          {t.layout.nav[item.labelKey]}
        </Link>
      ))}
    </nav>
  );
}
