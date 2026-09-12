import { Avatar, Style } from "@dicebear/core";
import loreleiNeutralDefinition from "@dicebear/styles/lorelei-neutral.json" with { type: "json" };

const loreleiNeutralStyle = new Style(loreleiNeutralDefinition);
const dataUriCache = new Map<string, string>();

export function getAvatarSrc({
  id,
  image,
}: {
  id: string;
  image?: string | null;
}): string {
  if (image) {
    return image;
  }

  const cached = dataUriCache.get(id);
  if (cached) {
    return cached;
  }

  const dataUri = new Avatar(loreleiNeutralStyle, { seed: id }).toDataUri();
  dataUriCache.set(id, dataUri);
  return dataUri;
}
