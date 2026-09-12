import { Home, Mail, ScrollText, Settings, Users } from "lucide-react";

export const adminSidebarItems = [
  { icon: Home, labelKey: "dashboard", to: "/admin" },
  { icon: Users, labelKey: "users", to: "/admin/users" },
  { icon: Mail, labelKey: "invitations", to: "/admin/invitations" },
  { icon: Settings, labelKey: "settings", to: "/admin/settings" },
  { icon: ScrollText, labelKey: "auditLog", to: "/admin/audit-log" },
] as const;
