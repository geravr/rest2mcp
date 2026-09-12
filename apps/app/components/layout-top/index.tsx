import { useSessionQuery } from "@/lib/queries/session";
import { PageTransition } from "./page-transition";
import { topNavItems } from "./constants";
import { MobileDrawer } from "./mobile-drawer";
import { Topbar } from "./topbar";

interface TopNavLayoutProps {
  children: React.ReactNode;
}

export function TopNavLayout({ children }: TopNavLayoutProps) {
  const { data: session } = useSessionQuery();
  const user = session?.user;

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground">
      <MobileDrawer items={topNavItems} user={user}>
        <Topbar />
      </MobileDrawer>
      <main className="relative flex-1 min-h-0 overflow-auto px-4 py-4 md:px-6 md:py-6">
        <div className="w-full max-w-6xl mx-auto">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
    </div>
  );
}
