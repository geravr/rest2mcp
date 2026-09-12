function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getConfiguredApiUrl(): string {
  const configured = import.meta.env.VITE_API_URL;

  if (configured) {
    return trimTrailingSlash(configured);
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "http://localhost:5173";
}

export function getApiOriginUrl(): string {
  const configured = getConfiguredApiUrl();

  return configured.endsWith("/api")
    ? configured.slice(0, -"/api".length)
    : configured;
}

export function getApiBaseUrl(): string {
  const configured = getConfiguredApiUrl();

  return configured.endsWith("/api") ? configured : `${configured}/api`;
}

export function getTrpcUrl(): string {
  return `${getApiBaseUrl()}/trpc`;
}
