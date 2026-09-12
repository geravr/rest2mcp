/**
 * @file Better Auth client instance.
 *
 * Do not use auth.useSession() directly - use TanStack Query wrappers
 * from lib/queries/session.ts to ensure proper caching and consistency.
 */

import { emailOTPClient } from "better-auth/client/plugins";
// Ensures Better Auth client types are portable under composite project refs.
import type {} from "better-auth/client";
import { createAuthClient } from "better-auth/react";
import { getApiOriginUrl } from "./api-url";
import { authConfig } from "./auth-config";

const baseURL = getApiOriginUrl();

export const auth = createAuthClient({
  baseURL: baseURL + authConfig.api.basePath,
  plugins: [emailOTPClient()],
});

export type AuthClient = typeof auth;

// Inferred types from configured instance - includes plugin extensions
// $Infer.Session is the full response shape { user, session }
type SessionResponse = typeof auth.$Infer.Session;
// Extend with server-side additionalFields that Better Auth returns at runtime
// but cannot infer on the client without a cross-boundary server import.
export type User = SessionResponse["user"] & {
  role?: "user" | "super_admin";
};
export type Session = SessionResponse["session"];
