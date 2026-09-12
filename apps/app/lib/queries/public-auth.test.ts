import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inviteValidationQueryOptions,
  registrationStatusQueryOptions,
} from "./public-auth";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe("registrationStatusQueryOptions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the public registration status endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ registrationEnabled: false, message: "Closed" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const queryClient = createQueryClient();
    const data = await queryClient.fetchQuery(registrationStatusQueryOptions());

    expect(data).toEqual({ registrationEnabled: false, message: "Closed" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/registration-status"),
      { credentials: "include" },
    );
  });
});

describe("inviteValidationQueryOptions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("encodes the invite token when validating", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ valid: true, email: "invitee@test.dev" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const queryClient = createQueryClient();
    const data = await queryClient.fetchQuery(
      inviteValidationQueryOptions("token with spaces"),
    );

    expect(data).toEqual({ valid: true, email: "invitee@test.dev" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("token%20with%20spaces"),
      { credentials: "include" },
    );
  });
});
