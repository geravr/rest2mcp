import { UserAvatar } from "@/components/user-avatar";
import { useTranslations } from "@/i18n/use-translations";
import { signOut } from "@/lib/queries/session";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, LogOut, Settings, Shield, User } from "lucide-react";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeSwitcher } from "./theme-switcher";

interface TopbarUser {
  id: string;
  email?: string | null;
  image?: string | null;
  name?: string | null;
  role?: string | null;
}

interface TopbarUserMenuProps {
  buttonClassName?: string;
  menuClassName?: string;
  menuAlign?: "start" | "end";
  menuSide?: "top" | "bottom";
  onNavigate?: () => void;
  trigger?: "avatar" | "profile-bar";
  user?: TopbarUser;
}

function TopbarUserMenuContent({
  user,
  onNavigate,
}: {
  user?: TopbarUser;
  onNavigate?: () => void;
}) {
  const { t } = useTranslations();
  const queryClient = useQueryClient();

  return (
    <>
      <DropdownMenuLabel className="font-normal">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground">
            {user?.name || t.layout.topbar.userFallback}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {user?.email}
          </span>
        </div>
      </DropdownMenuLabel>

      <DropdownMenuSeparator />

      {user?.role === "super_admin" && (
        <DropdownMenuItem asChild>
          <Link
            to="/admin"
            className="flex items-center gap-2"
            onClick={onNavigate}
          >
            <Shield className="h-4 w-4" />
            {t.layout.topbar.adminPanel}
          </Link>
        </DropdownMenuItem>
      )}

      <DropdownMenuItem asChild>
        <Link
          to="/settings"
          className="flex items-center gap-2"
          onClick={onNavigate}
        >
          <Settings className="h-4 w-4" />
          {t.layout.topbar.settingsLink}
        </Link>
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <div className="px-2 py-1.5">
        <LocaleSwitcher />
      </div>

      <div className="px-2 py-1.5">
        <ThemeSwitcher />
      </div>

      <DropdownMenuSeparator />

      <DropdownMenuItem
        onClick={() => signOut(queryClient)}
        className="text-destructive focus:text-destructive focus:bg-destructive/10"
      >
        <LogOut className="mr-2 h-4 w-4" />
        {t.layout.topbar.signOut}
      </DropdownMenuItem>
    </>
  );
}

export function TopbarUserMenu({
  user,
  trigger = "avatar",
  onNavigate,
  menuAlign = "end",
  menuSide = "bottom",
  menuClassName,
}: TopbarUserMenuProps) {
  const { t } = useTranslations();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger === "avatar" ? (
          <button
            type="button"
            aria-label={t.layout.topbar.openUserMenu}
            className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-secondary text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {user ? (
              <UserAvatar
                id={user.id}
                image={user.image}
                name={user.name}
                alt=""
                size="sm"
              />
            ) : (
              <User className="h-4 w-4" />
            )}
          </button>
        ) : (
          <button
            type="button"
            aria-label={t.layout.topbar.openUserMenu}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-secondary-foreground">
              {user ? (
                <UserAvatar
                  id={user.id}
                  image={user.image}
                  name={user.name}
                  alt=""
                  size="md"
                />
              ) : (
                <User className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {user?.name || t.layout.topbar.userFallback}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {user?.email}
              </p>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align={menuAlign}
        side={menuSide}
        className={menuClassName ?? "w-56"}
      >
        <TopbarUserMenuContent user={user} onNavigate={onNavigate} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
