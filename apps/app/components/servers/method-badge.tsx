import { Badge, cn } from "@repo/ui";

const METHOD_CLASS_NAMES: Record<string, string> = {
  GET: "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  POST: "border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200",
  PUT: "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  PATCH:
    "border-violet-200 bg-violet-100 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200",
  DELETE:
    "border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200",
};

/** Pastel pill per HTTP verb; unrecognized verbs stay a neutral outline. */
export function MethodBadge({
  method,
  className,
}: {
  method: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(METHOD_CLASS_NAMES[method.toUpperCase()], className)}
    >
      {method}
    </Badge>
  );
}
