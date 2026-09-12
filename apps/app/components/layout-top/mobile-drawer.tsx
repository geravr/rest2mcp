import { BrandLogo } from "@/components/brand-logo";
import { useTranslations } from "@/i18n/use-translations";
import { Button, useIsMobile } from "@repo/ui";
import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useState } from "react";
import { Drawer } from "vaul";
import type { TopNavItem } from "./constants";
import { MobileDrawerNav } from "./mobile-drawer-nav";
import { TopbarUserMenu } from "./topbar-user-menu";

interface MobileDrawerUser {
  id: string;
  email?: string | null;
  image?: string | null;
  name?: string | null;
  role?: string | null;
}

interface MobileDrawerProps {
  children: React.ReactNode;
  items: readonly TopNavItem[];
  user?: MobileDrawerUser;
}

function MobileDrawerHeader() {
  const { t } = useTranslations();

  return (
    <div className="border-b border-border px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
      <Link to="/" className="inline-flex min-w-0 shrink-0">
        <BrandLogo
          alt={t.layout.topbar.logoAlt}
          className="h-9 w-auto object-contain"
        />
      </Link>
    </div>
  );
}

export function MobileDrawerTrigger() {
  const { t } = useTranslations();

  return (
    <Drawer.Trigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0"
        aria-label={t.layout.topbar.openNavigationMenu}
      >
        <Menu className="h-5 w-5" />
      </Button>
    </Drawer.Trigger>
  );
}

export function MobileDrawer({ children, items, user }: MobileDrawerProps) {
  const { t } = useTranslations();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  function closeDrawer() {
    setOpen(false);
  }

  if (!isMobile) {
    return children;
  }

  return (
    <Drawer.Root
      open={open}
      onOpenChange={setOpen}
      direction="right"
      dismissible
      shouldScaleBackground={false}
    >
      {children}
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(85vw,320px)] flex-col border-l border-border bg-background outline-none">
          <Drawer.Title className="sr-only">
            {t.layout.topbar.primaryNavigation}
          </Drawer.Title>
          <Drawer.Description className="sr-only">
            {t.layout.topbar.primaryNavigation}
          </Drawer.Description>

          <MobileDrawerHeader />

          <div className="flex-1 overflow-y-auto">
            <MobileDrawerNav items={items} onNavigate={closeDrawer} />
          </div>

          <div className="shrink-0 border-t border-border px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            <TopbarUserMenu
              user={user}
              trigger="profile-bar"
              menuAlign="start"
              menuSide="top"
              menuClassName="w-[calc(100vw-2rem)] max-w-[288px]"
              onNavigate={closeDrawer}
            />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
