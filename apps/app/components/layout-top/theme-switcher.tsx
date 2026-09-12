import { useTranslations } from "@/i18n/use-translations";
import { getTheme, setTheme, subscribeToTheme, type Theme } from "@/lib/theme";
import { Button, cn } from "@repo/ui";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeSwitcher() {
  const { t } = useTranslations();
  const [activeTheme, setActiveTheme] = useState<Theme>(getTheme);

  useEffect(() => {
    const unsubscribe = subscribeToTheme(() => {
      setActiveTheme(getTheme());
    });
    return unsubscribe;
  }, []);

  function handleThemeChange(newTheme: Theme) {
    setTheme(newTheme);
    setActiveTheme(newTheme);
  }

  return (
    <div
      className="inline-flex items-center rounded-full border border-border bg-muted/50 p-1"
      aria-label={t.layout.topbar.themeSwitcher}
      role="group"
    >
      <Button
        type="button"
        variant={activeTheme === "light" ? "secondary" : "ghost"}
        size="sm"
        className={cn(
          "h-8 rounded-full px-3 text-xs font-semibold",
          activeTheme === "light" && "shadow-sm",
        )}
        aria-pressed={activeTheme === "light"}
        aria-label={t.layout.topbar.themeLight}
        onClick={() => handleThemeChange("light")}
      >
        <Sun className="h-3.5 w-3.5" />
        {t.layout.topbar.themeLight}
      </Button>
      <Button
        type="button"
        variant={activeTheme === "dark" ? "secondary" : "ghost"}
        size="sm"
        className={cn(
          "h-8 rounded-full px-3 text-xs font-semibold",
          activeTheme === "dark" && "shadow-sm",
        )}
        aria-pressed={activeTheme === "dark"}
        aria-label={t.layout.topbar.themeDark}
        onClick={() => handleThemeChange("dark")}
      >
        <Moon className="h-3.5 w-3.5" />
        {t.layout.topbar.themeDark}
      </Button>
    </div>
  );
}
