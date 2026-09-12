import { describe, expect, it } from "vitest";
import { buildProtectedRouteReturnTo } from "./auth-redirect";

function createTanStackLocation(href: string) {
  const pathname = href.split(/[?#]/)[0];
  const search = Object.assign(Object.create(null), {
    tab: href.includes("tab=security") ? "security" : undefined,
  });

  return {
    pathname,
    search,
    hash: href.includes("#") ? href.slice(href.indexOf("#")) : "",
    href,
  };
}

describe("buildProtectedRouteReturnTo", () => {
  it("returns location.href when session is missing", () => {
    const location = createTanStackLocation("/settings?tab=security");

    expect(buildProtectedRouteReturnTo(location)).toBe(
      "/settings?tab=security",
    );
    expect(typeof buildProtectedRouteReturnTo(location)).toBe("string");
  });

  it("fails if parsed search is concatenated instead of using href", () => {
    const location = createTanStackLocation("/settings?tab=security");

    expect(() => location.pathname + location.search + location.hash).toThrow(
      /Cannot convert object to primitive value/,
    );
    expect(buildProtectedRouteReturnTo(location)).toBe(location.href);
  });
});
