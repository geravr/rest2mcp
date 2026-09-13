import { getServerIconSrc } from "@/lib/server-icon";
import { cn } from "@repo/ui";

const SIZES = {
  sm: "h-6 w-6",
  md: "h-9 w-9",
  lg: "h-12 w-12",
} as const;

/** Server icon from custom upload or DiceBear rings fallback. */
export function ServerIcon({
  serverId,
  iconImage,
  size = "md",
}: {
  serverId: string;
  iconImage?: string | null;
  size?: keyof typeof SIZES;
}) {
  const src = getServerIconSrc({ id: serverId, iconImage });

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={cn("shrink-0 rounded-md object-contain", SIZES[size])}
    />
  );
}
