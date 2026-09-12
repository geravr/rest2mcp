import { cn } from "@repo/ui";
import type { ComponentProps } from "react";

interface BrandIconProps extends Omit<ComponentProps<"img">, "src" | "alt"> {
  alt?: string;
}

export function BrandIcon({ className, alt = "", ...props }: BrandIconProps) {
  return (
    <>
      <img
        src="/icon-light.png"
        alt={alt}
        className={cn("block dark:hidden", className)}
        {...props}
      />
      <img
        src="/icon-dark.png"
        alt=""
        aria-hidden="true"
        className={cn("hidden dark:block", className)}
        {...props}
      />
    </>
  );
}
