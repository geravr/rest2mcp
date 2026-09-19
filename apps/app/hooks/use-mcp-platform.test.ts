import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTranslations } from "@/i18n";
import type { McpPlatformScope } from "@/lib/mcp-limits";

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const { mcp, mutationFn } = vi.hoisted(() => {
  const mutationFn = vi.fn();
  const makeProc = () => ({
    queryOptions: vi.fn((input?: unknown) => ({
      queryKey: [["mcp"], input],
      queryFn: vi.fn(async () => ({
        items: [],
        page: 1,
        pageSize: 10,
        total: 0,
      })),
    })),
    pathFilter: vi.fn(() => ({ queryKey: [["mcp"]] })),
    queryKey: vi.fn(() => [["mcp"]]),
    mutationOptions: vi.fn(() => ({ mutationFn })),
  });

  const names = [
    "servers",
    "getServer",
    "tools",
    "toolGroups",
    "tokens",
    "variables",
    "serverCommon",
    "callLogs",
    "publishPreview",
    "revisionHistory",
    "revisionDetail",
    "publishServer",
    "restoreRevision",
    "previewOpenApiImport",
    "confirmOpenApiImport",
    "platformTokens",
    "platformSecurityEvents",
    "platformSnippet",
    "createPlatformToken",
    "rotatePlatformToken",
    "revokePlatformToken",
    "requestPlatformStepUp",
    "verifyPlatformStepUp",
  ] as const;

  const mcp: Record<string, ReturnType<typeof makeProc>> = {};
  for (const name of names) mcp[name] = makeProc();

  return { mcp, mutationFn };
});

vi.mock("@/lib/trpc", () => ({
  trpcClient: {},
  api: { mcp },
}));

vi.mock("@/i18n/use-translations", async () => {
  const { getTranslations } = await import("@/i18n");
  return {
    useTranslations: () => ({
      t: getTranslations("en"),
      locale: "en",
      setLocale: vi.fn(),
    }),
  };
});

import { api } from "@/lib/trpc";
import {
  useCreatePlatformToken,
  usePlatformSnippet,
  usePlatformTokens,
  useRequestPlatformStepUp,
  useRevokePlatformToken,
  useRotatePlatformToken,
  useVerifyPlatformStepUp,
} from "./use-mcp";

const en = getTranslations("en");

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

const createPayload = {
  name: "Claude desktop",
  scopes: ["read"] as McpPlatformScope[],
  resourceMode: "selected" as const,
  serverIds: ["srv_1"],
  expiresInDays: 30,
};

const createdToken = {
  id: "pat_1",
  name: "Claude desktop",
  prefix: "pat_live_ab",
  token: "pat_raw_value",
};

describe("platform token hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the requested pagination to the inventory query", () => {
    const queryClient = createQueryClient();
    renderHook(() => usePlatformTokens({ page: 2, pageSize: 20 }), {
      wrapper: createWrapper(queryClient),
    });

    expect(mcp.platformTokens.queryOptions).toHaveBeenCalledWith({
      page: 2,
      pageSize: 20,
    });
  });

  it("fetches the platform snippet without an input", () => {
    const queryClient = createQueryClient();
    renderHook(() => usePlatformSnippet(), {
      wrapper: createWrapper(queryClient),
    });

    expect(mcp.platformSnippet.queryOptions).toHaveBeenCalledWith();
  });

  it("creates a token, invalidates the inventory and ledger, and toasts", async () => {
    mutationFn.mockResolvedValue(createdToken);
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreatePlatformToken(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(createPayload);
    });

    expect(mutationFn.mock.calls[0]?.[0]).toEqual(createPayload);
    expect(invalidateSpy).toHaveBeenCalledWith(
      api.mcp.platformTokens.pathFilter(),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      api.mcp.platformSecurityEvents.pathFilter(),
    );
    expect(toastSuccess).toHaveBeenCalledWith(en.toasts.platform.tokenCreated);
  });

  it("rotates a token through the rotate mutation and invalidates the inventory", async () => {
    mutationFn.mockResolvedValue(createdToken);
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRotatePlatformToken(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        ...createPayload,
        tokenId: "pat_1",
      });
    });

    expect(mcp.rotatePlatformToken.mutationOptions).toHaveBeenCalled();
    expect(mutationFn.mock.calls[0]?.[0]).toEqual({
      ...createPayload,
      tokenId: "pat_1",
    });
    expect(invalidateSpy).toHaveBeenCalledWith(
      api.mcp.platformTokens.pathFilter(),
    );
    expect(toastSuccess).toHaveBeenCalledWith(en.toasts.platform.tokenCreated);
  });

  it("revokes a token and toasts the revocation", async () => {
    mutationFn.mockResolvedValue({ id: "pat_1", revokedAt: new Date() });
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRevokePlatformToken(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ tokenId: "pat_1" });
    });

    expect(mcp.revokePlatformToken.mutationOptions).toHaveBeenCalled();
    expect(mutationFn.mock.calls[0]?.[0]).toEqual({ tokenId: "pat_1" });
    expect(invalidateSpy).toHaveBeenCalledWith(
      api.mcp.platformTokens.pathFilter(),
    );
    expect(toastSuccess).toHaveBeenCalledWith(en.toasts.platform.tokenRevoked);
  });

  it("requests a step-up challenge", async () => {
    mutationFn.mockResolvedValue({ sent: true });
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useRequestPlatformStepUp(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(mcp.requestPlatformStepUp.mutationOptions).toHaveBeenCalled();
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });

  it("verifies the step-up code with the canonical grant request", async () => {
    mutationFn.mockResolvedValue({ grantId: "step_1" });
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useVerifyPlatformStepUp(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        otp: "123456",
        scopes: ["read"],
        resourceMode: "account",
      });
    });

    expect(mcp.verifyPlatformStepUp.mutationOptions).toHaveBeenCalled();
    expect(mutationFn.mock.calls[0]?.[0]).toEqual({
      otp: "123456",
      scopes: ["read"],
      resourceMode: "account",
    });
  });

  it("surfaces a localized error when step-up verification fails", async () => {
    mutationFn.mockRejectedValue(
      new Error("The verification code is invalid or expired."),
    );
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useVerifyPlatformStepUp(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          otp: "000000",
          scopes: ["read"],
          resourceMode: "selected",
          serverIds: ["srv_1"],
        }),
      ).rejects.toThrow();
    });

    expect(toastError).toHaveBeenCalledWith(
      "The verification code is invalid or expired.",
    );
  });
});
