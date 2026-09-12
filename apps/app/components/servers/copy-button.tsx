import { useTranslations } from "@/i18n/use-translations";
import { Button } from "@repo/ui";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function CopyButton({ value }: { value: string }) {
  const { t } = useTranslations();
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        toast.success(t.toasts.servers.copied);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? t.servers.copied : t.servers.copy}
    </Button>
  );
}
