import { Avatar, Style } from "@dicebear/core";
import ringsDefinition from "@dicebear/styles/rings.json" with { type: "json" };

const ringsStyle = new Style(ringsDefinition);
const dataUriCache = new Map<string, string>();

export function getServerIconSrc({
  id,
  iconUrl,
}: {
  id: string;
  iconUrl?: string | null;
}): string {
  if (iconUrl) {
    return iconUrl;
  }

  const cached = dataUriCache.get(id);
  if (cached) {
    return cached;
  }

  const dataUri = new Avatar(ringsStyle, { seed: id }).toDataUri();
  dataUriCache.set(id, dataUri);
  return dataUri;
}
