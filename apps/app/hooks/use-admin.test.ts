import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mutationMocks = vi.hoisted(() => ({
  banUser: vi.fn(),
  unbanUser: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  updateRegistration: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpcClient: {},
  api: {
    admin: {
      users: { pathFilter: () => ({ queryKey: [["admin", "users"]] }) },
      stats: { pathFilter: () => ({ queryKey: [["admin", "stats"]] }) },
      invitations: {
        pathFilter: () => ({ queryKey: [["admin", "invitations"]] }),
      },
      settings: { pathFilter: () => ({ queryKey: [["admin", "settings"]] }) },
      auditLog: { pathFilter: () => ({ queryKey: [["admin", "auditLog"]] }) },
      banUser: {
        mutationOptions: () => ({ mutationFn: mutationMocks.banUser }),
      },
      unbanUser: {
        mutationOptions: () => ({ mutationFn: mutationMocks.unbanUser }),
      },
      createInvitation: {
        mutationOptions: () => ({ mutationFn: mutationMocks.createInvitation }),
      },
      revokeInvitation: {
        mutationOptions: () => ({ mutationFn: mutationMocks.revokeInvitation }),
      },
      updateRegistration: {
        mutationOptions: () => ({
          mutationFn: mutationMocks.updateRegistration,
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

vi.mock("@/i18n/use-translations", () => ({
  useTranslations: () => ({
    t: {
      toasts: {
        admin: {
          userSuspended: "User suspended",
          userReactivated: "User reactivated",
          invitationSent: "Invitation sent",
          invitationRevoked: "Invitation revoked",
          registrationEnabled: "Registration enabled",
          registrationDisabled: "Registration disabled",
        },
      },
    },
  }),
}));

import { api } from "@/lib/trpc";
import {
  useBanUser,
  useCreateInvitation,
  useRevokeInvitation,
  useUnbanUser,
  useUpdateRegistration,
} from "./use-admin";

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

const handmadeAdminUsersFilter = { queryKey: ["admin", "users"] as const };
const handmadeAdminInvitationsFilter = {
  queryKey: ["admin", "invitations"] as const,
};

const bannedUserResult = {
  id: "user-1",
  name: "Test User",
  email: "test@test.dev",
  bannedAt: "2024-01-01T00:00:00.000Z",
};

const unbannedUserResult = {
  ...bannedUserResult,
  bannedAt: null,
};

const invitationResult = {
  id: "inv-1",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  expiresAt: "2024-02-01T00:00:00.000Z",
  token: "invite-token",
  email: "new@test.dev",
  status: "pending",
  acceptedAt: null,
  invitedBy: "admin-1",
};

const registrationSettingsResult = {
  id: "settings-1",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  registrationEnabled: true,
  registrationDisabledMessage: null,
};

describe("admin mutation invalidation", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("banUser invalidates every users/auditLog page and filter variant via pathFilter", async () => {
    mutationMocks.banUser.mockResolvedValue(bannedUserResult);
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useBanUser(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ userId: "user-1" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(api.admin.users.pathFilter());
    expect(invalidateSpy).toHaveBeenCalledWith(api.admin.stats.pathFilter());
    expect(invalidateSpy).toHaveBeenCalledWith(api.admin.auditLog.pathFilter());
    expect(invalidateSpy).not.toHaveBeenCalledWith(handmadeAdminUsersFilter);
  });

  it("unbanUser invalidates every users/auditLog page and filter variant via pathFilter", async () => {
    mutationMocks.unbanUser.mockResolvedValue(unbannedUserResult);
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUnbanUser(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ userId: "user-1" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(api.admin.users.pathFilter());
    expect(invalidateSpy).toHaveBeenCalledWith(api.admin.stats.pathFilter());
    expect(invalidateSpy).toHaveBeenCalledWith(api.admin.auditLog.pathFilter());
    expect(invalidateSpy).not.toHaveBeenCalledWith(handmadeAdminUsersFilter);
  });

  it("createInvitation invalidates every invitations/auditLog page and filter variant via pathFilter", async () => {
    mutationMocks.createInvitation.mockResolvedValue(invitationResult);
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateInvitation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ email: "new@test.dev" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      api.admin.invitations.pathFilter(),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(api.admin.stats.pathFilter());
    expect(invalidateSpy).toHaveBeenCalledWith(api.admin.auditLog.pathFilter());
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      handmadeAdminInvitationsFilter,
    );
  });

  it("revokeInvitation invalidates every invitations/auditLog page and filter variant via pathFilter", async () => {
    mutationMocks.revokeInvitation.mockResolvedValue({
      ...invitationResult,
      status: "revoked",
    });
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRevokeInvitation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ invitationId: "inv-1" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      api.admin.invitations.pathFilter(),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(api.admin.stats.pathFilter());
    expect(invalidateSpy).toHaveBeenCalledWith(api.admin.auditLog.pathFilter());
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      handmadeAdminInvitationsFilter,
    );
  });

  it("updateRegistration invalidates settings and stats via pathFilter", async () => {
    mutationMocks.updateRegistration.mockResolvedValue(
      registrationSettingsResult,
    );
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateRegistration(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ enabled: true });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(api.admin.settings.pathFilter());
    expect(invalidateSpy).toHaveBeenCalledWith(api.admin.stats.pathFilter());
    expect(invalidateSpy).not.toHaveBeenCalledWith(handmadeAdminUsersFilter);
  });
});
