import { useTranslations } from "@/i18n/use-translations";
import { Badge } from "@repo/ui";

type TrafficLightValue = "draft" | "green" | "yellow" | "red" | "paused";

const variant: Record<
  TrafficLightValue,
  "secondary" | "default" | "outline" | "destructive"
> = {
  draft: "secondary",
  green: "default",
  yellow: "outline",
  red: "destructive",
  paused: "secondary",
};

export function TrafficLightBadge({ value }: { value: TrafficLightValue }) {
  const { t } = useTranslations();
  const labels: Record<TrafficLightValue, string> = {
    draft: t.servers.trafficDraft,
    green: t.servers.trafficGreen,
    yellow: t.servers.trafficYellow,
    red: t.servers.trafficRed,
    paused: t.servers.trafficPaused,
  };

  return <Badge variant={variant[value]}>{labels[value]}</Badge>;
}
