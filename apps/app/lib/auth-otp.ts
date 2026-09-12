import { getApiBaseUrl } from "./api-url";

interface AuthOtpError {
  code?: string;
  message: string;
  status: number;
}

interface AuthOtpResult<T = unknown> {
  data?: T;
  error?: AuthOtpError;
}

function withInviteToken(path: string, inviteToken?: string): string {
  if (!inviteToken) return path;

  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}invite=${encodeURIComponent(inviteToken)}`;
}

async function postAuthOtp<T>(
  path: string,
  payload: Record<string, unknown>,
): Promise<AuthOtpResult<T>> {
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => null)) as {
      code?: string;
      error?: string;
      message?: string;
    } | null;

    if (!response.ok) {
      return {
        error: {
          code: body?.code,
          message:
            body?.message ?? body?.error ?? "Authentication request failed.",
          status: response.status,
        },
      };
    }

    return { data: (body ?? {}) as T };
  } catch {
    return {
      error: {
        message: "Authentication request failed.",
        status: 500,
      },
    };
  }
}

export function requestLoginOtp(email: string) {
  return postAuthOtp<{ success: boolean }>("/auth/otp/login/send", { email });
}

export function verifyLoginOtp(email: string, otp: string) {
  return postAuthOtp<{ token?: string }>("/auth/otp/login/verify", {
    email,
    otp,
  });
}

export function requestSignupOtp(email: string, inviteToken?: string) {
  return postAuthOtp<{ success: boolean }>(
    withInviteToken("/auth/otp/signup/send", inviteToken),
    {
      email,
    },
  );
}

export function verifySignupOtp(params: {
  email: string;
  otp: string;
  name: string;
  inviteToken?: string;
}) {
  const { inviteToken, ...payload } = params;

  return postAuthOtp<{ token?: string }>(
    withInviteToken("/auth/otp/signup/verify", inviteToken),
    payload,
  );
}
