import { cn } from "@repo/ui";
import { useMemo, useState } from "react";

const SIZES = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
} as const;

function initialsOf(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return initials || "S";
}

/**
 * Domain favicon fetched from Google's s2 service, with a neutral initials
 * fallback when the host is unparseable or the image fails to load.
 */
export function ServerFavicon({
  baseUrl,
  name,
  size = "md",
}: {
  baseUrl: string;
  name: string;
  size?: keyof typeof SIZES;
}) {
  const [failed, setFailed] = useState(false);
  const host = useMemo(() => {
    try {
      return new URL(baseUrl).hostname;
    } catch {
      return null;
    }
  }, [baseUrl]);

  if (!host || failed) {
    return (
      <div
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground",
          SIZES[size],
        )}
      >
        {initialsOf(name)}
      </div>
    );
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`}
      alt=""
      loading="lazy"
      className={cn("shrink-0 rounded-md", SIZES[size])}
      onError={() => setFailed(true)}
    />
  );
}
