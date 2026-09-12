import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mutationMocks = vi.hoisted(() => ({
  updateObservabilitySettings: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpcClient: {},
  api: {
    user: {
      observabilitySettings: {
        pathFilter: () => ({ queryKey: [["user", "observabilitySettings"]] }),
        queryKey: () => [["user", "observabilitySettings"], { type: "query" }],
      },
      updateObservabilitySettings: {
        mutationOptions: () => ({
          mutationFn: mutationMocks.updateObservabilitySettings,
        }),
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/posthog", () => ({
  captureHandledPostHogException: vi.fn(),
}));

vi.mock("@/i18n/use-translations", () => ({
  useTranslations: () => ({
    t: {
      settings: {
        privacy: {
          errorDescription: "Not signed in",
        },
      },
      toasts: {
        observability: {
          enabled: "Enabled",
          disabled: "Disabled",
          privacyUpdated: "Updated",
        },
      },
    },
  }),
}));

vi.mock("@/lib/queries/session", () => ({
  useSessionQuery: () => ({
    data: {
      user: { id: "user-1" },
      session: { id: "session-1" },
    },
  }),
}));

import { api } from "@/lib/trpc";
import { useUpdateObservabilitySettings } from "./use-observability";

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

describe("useUpdateObservabilitySettings", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates observability settings via pathFilter on success", async () => {
    const settings = {
      consentStatus: "granted" as const,
      sessionReplayEnabled: true,
      errorTrackingEnabled: true,
      consentUpdatedAt: null,
    };

    mutationMocks.updateObservabilitySettings.mockResolvedValue(settings);
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");

    const { result } = renderHook(() => useUpdateObservabilitySettings(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ consentStatus: "granted" });
    });

    expect(setQueryDataSpy).toHaveBeenCalledWith(
      api.user.observabilitySettings.queryKey(),
      settings,
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      api.user.observabilitySettings.pathFilter(),
    );
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ["user", "observability-settings"],
    });
  });
});
