import { cn } from "@repo/ui";
import type { ComponentProps } from "react";

const LOGO_WIDTH = 232;
const LOGO_HEIGHT = 43;

interface BrandLogoProps extends Omit<ComponentProps<"img">, "src" | "alt"> {
  alt: string;
}

export function BrandLogo({ className, alt, ...props }: BrandLogoProps) {
  return (
    <>
      <img
        src="/logo-light.png"
        alt={alt}
        width={LOGO_WIDTH}
        height={LOGO_HEIGHT}
        className={cn("block dark:hidden", className)}
        {...props}
      />
      <img
        src="/logo-dark.png"
        alt=""
        aria-hidden="true"
        width={LOGO_WIDTH}
        height={LOGO_HEIGHT}
        className={cn("hidden dark:block", className)}
        {...props}
      />
    </>
  );
}
