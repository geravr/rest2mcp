import type { UI } from "@/i18n";
import type { FileRoutesByTo } from "@/lib/routeTree.gen";

export interface TopNavItem {
  labelKey: keyof UI["layout"]["nav"];
  to: keyof FileRoutesByTo;
  exact?: boolean;
}

// Settings is intentionally excluded — it lives in the user dropdown.
export const topNavItems: readonly TopNavItem[] = [
  {
    labelKey: "home",
    to: "/",
    exact: true,
  },
  {
    labelKey: "servers",
    to: "/servers",
  },
] as const;
