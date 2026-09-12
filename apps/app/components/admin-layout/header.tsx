import { useTranslations } from "@/i18n/use-translations";
import { Button } from "@repo/ui";
import { Menu, X } from "lucide-react";

interface AdminHeaderProps {
  isSidebarOpen: boolean;
  onMenuToggle: () => void;
}

export function AdminHeader({ isSidebarOpen, onMenuToggle }: AdminHeaderProps) {
  const { t } = useTranslations();
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-border bg-background px-4 md:px-6">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onMenuToggle}
        className="shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={t.admin.layout.toggleMenu}
      >
        {isSidebarOpen ? (
          <X className="h-5 w-5" />
        ) : (
          <Menu className="h-5 w-5" />
        )}
      </Button>

      <div className="flex min-w-0 flex-1 items-center">
        <span className="text-sm font-semibold text-muted-foreground">
          {t.admin.layout.headerTitle}
        </span>
      </div>
    </header>
  );
}
