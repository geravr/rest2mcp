import { getApiBaseUrl } from "@/lib/api-url";
import { queryOptions, useQuery } from "@tanstack/react-query";

export interface RegistrationStatus {
  registrationEnabled: boolean;
  message: string | null;
}

export interface InviteValidationResult {
  valid: boolean;
  email?: string;
  message?: string;
}

class PublicAuthRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PublicAuthRequestError";
    this.status = status;
  }
}

async function parseJsonBody<T>(response: Response): Promise<T | null> {
  return (await response.json().catch(() => null)) as T | null;
}

async function fetchPublicAuthJson<T>(path: string): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    credentials: "include",
  });

  const body = await parseJsonBody<{ message?: string }>(response);

  if (!response.ok) {
    throw new PublicAuthRequestError(
      body?.message ?? "Failed to load public authentication settings.",
      response.status,
    );
  }

  return (body ?? {}) as T;
}

export function registrationStatusQueryOptions() {
  return queryOptions<RegistrationStatus>({
    queryKey: ["public-auth", "registration-status"],
    queryFn: () =>
      fetchPublicAuthJson<RegistrationStatus>("/auth/registration-status"),
    staleTime: 0,
    retry: 1,
  });
}

export function inviteValidationQueryOptions(token: string) {
  return queryOptions<InviteValidationResult>({
    queryKey: ["public-auth", "invite-validation", token],
    queryFn: () =>
      fetchPublicAuthJson<InviteValidationResult>(
        `/auth/validate-invite?token=${encodeURIComponent(token)}`,
      ),
    staleTime: 0,
    retry: false,
  });
}

export function useRegistrationStatusQuery() {
  return useQuery(registrationStatusQueryOptions());
}
