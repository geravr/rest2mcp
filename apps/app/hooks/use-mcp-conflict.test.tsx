import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import type { ReactNode } from "react";
import { useMcpMutationError } from "./use-mcp";

const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}));

function makeWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useMcpMutationError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates and reloads the aggregate on MCP_WRITE_CONFLICT", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useMcpMutationError(), {
      wrapper: makeWrapper(queryClient),
    });

    result.current({ data: { appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT } });

    expect(spy).toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    // A stale mutation must never be reported as saved.
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("does not invalidate for unrelated failures", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useMcpMutationError(), {
      wrapper: makeWrapper(queryClient),
    });

    result.current({ data: { appCode: APP_ERROR_CODES.INVALID_INPUT } });

    expect(spy).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
