import { getAvatarSrc } from "@/lib/avatar";
import { cn } from "@repo/ui";

const sizeClassName = {
  sm: "h-8 w-8 shrink-0",
  md: "h-9 w-9 shrink-0",
  lg: "h-16 w-16 shrink-0",
} as const;

export type UserAvatarSize = keyof typeof sizeClassName;

export function UserAvatar({
  id,
  image,
  name,
  alt,
  className,
  size = "sm",
}: {
  id: string;
  image?: string | null;
  name?: string | null;
  alt?: string;
  className?: string;
  size?: UserAvatarSize;
}) {
  const src = getAvatarSrc({ id, image });
  const resolvedAlt = alt ?? name ?? "";

  return (
    <img
      src={src}
      alt={resolvedAlt}
      className={cn(
        "rounded-full border border-muted-foreground/20 object-cover",
        sizeClassName[size],
        className,
      )}
    />
  );
}
