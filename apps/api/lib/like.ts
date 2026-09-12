export function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

export function likeContainsPattern(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}

export function normalizeSearchQuery(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
