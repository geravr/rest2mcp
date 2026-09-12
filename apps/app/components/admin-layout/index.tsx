import { useIsMobile } from "@repo/ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { AdminHeader } from "./header";
import { AdminSidebar } from "./sidebar";

interface AdminLayoutProps {
  children: React.ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const prefersReducedMotion = useReducedMotion();

  const isSidebarOpen = isMobile ? mobileSidebarOpen : desktopSidebarOpen;

  const handleMenuToggle = () => {
    if (isMobile) {
      setMobileSidebarOpen((open) => !open);
      return;
    }
    setDesktopSidebarOpen((open) => !open);
  };

  return (
    <div className="fixed inset-0 flex overflow-hidden bg-background text-foreground">
      {isMobile ? (
        <AnimatePresence>
          {mobileSidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-black/60"
                onClick={() => setMobileSidebarOpen(false)}
              />
              <motion.div
                initial={
                  prefersReducedMotion
                    ? { opacity: 1, x: 0 }
                    : { opacity: 0, x: -30 }
                }
                animate={{ opacity: 1, x: 0 }}
                exit={
                  prefersReducedMotion
                    ? { opacity: 1, x: 0 }
                    : { opacity: 0, x: -30 }
                }
                transition={
                  prefersReducedMotion
                    ? { duration: 0 }
                    : {
                        duration: 0.3,
                        ease: [0.25, 0.46, 0.45, 0.94],
                        type: "tween",
                      }
                }
                className="fixed inset-y-0 left-0 z-50 w-64 bg-background shadow-lg"
              >
                <div className="h-full overflow-hidden">
                  <AdminSidebar
                    isOpen={true}
                    isMobile
                    onNavigate={() => setMobileSidebarOpen(false)}
                  />
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      ) : (
        <AdminSidebar isOpen={desktopSidebarOpen} />
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <AdminHeader
          isSidebarOpen={isSidebarOpen}
          onMenuToggle={handleMenuToggle}
        />

        <main className="relative flex-1 min-h-0 overflow-auto px-4 py-4 md:px-6 md:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
