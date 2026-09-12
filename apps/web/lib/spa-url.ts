const spaOrigin = (
  import.meta.env.PUBLIC_SPA_ORIGIN ?? "http://localhost:5173"
).replace(/\/$/, "");

export function spaUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${spaOrigin}${normalizedPath}`;
}
