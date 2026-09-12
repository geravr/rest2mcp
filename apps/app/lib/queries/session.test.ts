import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const signOutMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@/lib/trpc", () => ({
  api: {
    user: {
      pathFilter: () => ({ queryKey: [["user"]] }),
    },
  },
  trpcClient: {},
}));

vi.mock("../auth", () => ({
  auth: {
    signOut: signOutMock,
    getSession: vi.fn(),
  },
}));

vi.mock("@/lib/posthog", () => ({
  capturePostHogEvent: vi.fn(),
  resetPostHogIdentity: vi.fn(),
}));

import { api } from "@/lib/trpc";
import {
  clearUserTrpcQueries,
  getCachedSession,
  isAuthenticated,
  revalidateSession,
  signOut,
  sessionQueryKey,
} from "./session";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

const userMeCacheKey = [["user", "me"], { type: "query" }] as const;
const observabilityCacheKey = [
  ["user", "observabilitySettings"],
  { type: "query" },
] as const;

describe("isAuthenticated", () => {
  it("returns false when no session data cached", () => {
    const queryClient = createQueryClient();
    expect(isAuthenticated(queryClient)).toBe(false);
  });

  it("returns false when session is null", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(sessionQueryKey, null);
    expect(isAuthenticated(queryClient)).toBe(false);
  });

  it("returns false when user is missing", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(sessionQueryKey, {
      session: { id: "1" },
      user: null,
    });
    expect(isAuthenticated(queryClient)).toBe(false);
  });

  it("returns false when session is missing", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(sessionQueryKey, {
      user: { id: "1" },
      session: null,
    });
    expect(isAuthenticated(queryClient)).toBe(false);
  });

  it("returns true when both user and session exist", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(sessionQueryKey, {
      user: { id: "user-1", email: "test@example.com" },
      session: { id: "session-1", expiresAt: new Date() },
    });
    expect(isAuthenticated(queryClient)).toBe(true);
  });
});

describe("getCachedSession", () => {
  it("returns undefined when no data cached", () => {
    const queryClient = createQueryClient();
    expect(getCachedSession(queryClient)).toBeUndefined();
  });

  it("returns cached session data", () => {
    const queryClient = createQueryClient();
    const sessionData = {
      user: { id: "user-1" },
      session: { id: "session-1" },
    };
    queryClient.setQueryData(sessionQueryKey, sessionData);
    expect(getCachedSession(queryClient)).toEqual(sessionData);
  });
});

describe("clearUserTrpcQueries", () => {
  it("removes cached tRPC user router queries", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(userMeCacheKey, { id: "user-a" });
    queryClient.setQueryData(observabilityCacheKey, {
      consentStatus: "granted",
    });

    clearUserTrpcQueries(queryClient);

    expect(queryClient.getQueryData(userMeCacheKey)).toBeUndefined();
    expect(queryClient.getQueryData(observabilityCacheKey)).toBeUndefined();
  });
});

describe("revalidateSession", () => {
  it("clears session and user tRPC cache then invalidates the router", async () => {
    const queryClient = createQueryClient();
    const removeSpy = vi.spyOn(queryClient, "removeQueries");
    const router = { invalidate: vi.fn().mockResolvedValue(undefined) };

    await revalidateSession(queryClient, router);

    expect(removeSpy).toHaveBeenCalledWith({ queryKey: sessionQueryKey });
    expect(removeSpy).toHaveBeenCalledWith(api.user.pathFilter());
    expect(router.invalidate).toHaveBeenCalledOnce();
  });
});

describe("signOut", () => {
  afterEach(() => {
    signOutMock.mockClear();
  });

  it("clears session cache, user tRPC cache, and redirects by default", async () => {
    const queryClient = createQueryClient();
    const removeSpy = vi.spyOn(queryClient, "removeQueries");
    queryClient.setQueryData(sessionQueryKey, {
      user: { id: "user-1" },
      session: { id: "session-1" },
    });
    queryClient.setQueryData(userMeCacheKey, { id: "user-1" });

    await signOut(queryClient);

    expect(signOutMock).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(sessionQueryKey)).toBeNull();
    expect(removeSpy).toHaveBeenCalledWith(api.user.pathFilter());
    expect(window.location.href).toContain("/login");
  });

  it("skips redirect when redirect is false", async () => {
    const queryClient = createQueryClient();
    window.location.href = "http://localhost:3000/settings";

    await signOut(queryClient, { redirect: false });

    expect(window.location.href).toContain("/settings");
    expect(window.location.href).not.toContain("/login");
  });
});
