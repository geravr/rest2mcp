import { BrandIcon } from "@/components/brand-icon";

export function SessionLoadingScreen() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6 py-10">
      <div className="relative flex h-24 w-24 items-center justify-center sm:h-28 sm:w-28">
        <div className="absolute inset-0 rounded-full border-2 border-muted" />
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary/70" />
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-background sm:h-20 sm:w-20">
          <BrandIcon className="h-12 w-12 sm:h-14 sm:w-14" />
        </div>
      </div>
    </div>
  );
}
