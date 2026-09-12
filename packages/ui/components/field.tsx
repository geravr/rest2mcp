import * as React from "react";

import { cn } from "../lib/utils";

function Field({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid gap-2", className)} {...props} />;
}

function FieldError({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  if (!children) {
    return null;
  }

  return (
    <p
      className={cn("text-sm text-destructive", className)}
      role="alert"
      {...props}
    >
      {children}
    </p>
  );
}

function FieldHint({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

export { Field, FieldError, FieldHint };
