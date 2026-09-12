import { useTranslations } from "@/i18n/use-translations";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Shield } from "lucide-react";
import { adminSidebarItems } from "./constants";
import { AdminSidebarNav } from "./sidebar-nav";

interface AdminSidebarProps {
  isOpen: boolean;
  isMobile?: boolean;
  onNavigate?: () => void;
}

export function AdminSidebar({
  isOpen,
  isMobile,
  onNavigate,
}: AdminSidebarProps) {
  const { t } = useTranslations();
  return (
    <aside
      className={`${isOpen ? "w-64" : "w-0"} ${
        isMobile
          ? "h-full border-r-0"
          : "sticky top-0 h-screen border-r border-border"
      } shrink-0 self-start overflow-hidden bg-muted transition-all duration-300 ease-in-out`}
    >
      <div className="flex h-full flex-col">
        <div className="px-4 py-4">
          <div className="flex items-center justify-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              {t.admin.layout.adminPanelLabel}
            </span>
          </div>
        </div>

        <AdminSidebarNav items={adminSidebarItems} onNavigate={onNavigate} />

        <div className="border-t border-border p-3">
          <Link
            to="/"
            className="group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
            onClick={onNavigate}
          >
            <ArrowLeft className="h-4 w-4 text-primary transition-colors group-hover:text-primary" />
            <span>{t.admin.layout.backToApp}</span>
          </Link>
        </div>
      </div>
    </aside>
  );
}
