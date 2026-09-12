import type { AppRouter } from "@repo/api";
import {
  createTRPCClient,
  httpBatchLink,
  loggerLink,
  type TRPCLink,
} from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { getTrpcUrl } from "./api-url";
import { queryClient } from "./query";

// Build links array conditionally based on environment
const links: TRPCLink<AppRouter>[] = [];

// Add logger link in development for debugging
if (import.meta.env.DEV) {
  links.push(
    loggerLink({
      enabled: (opts) =>
        (import.meta.env.DEV && typeof window !== "undefined") ||
        (opts.direction === "down" && opts.result instanceof Error),
    }),
  );
}

// Add HTTP batch link for actual requests
links.push(
  httpBatchLink({
    url: getTrpcUrl(),
    // Custom headers for request tracking
    headers() {
      return {
        "x-trpc-source": "react-app",
      };
    },
    // Include credentials for authentication
    fetch(url, options) {
      return fetch(url, {
        ...options,
        credentials: "include",
      });
    },
  }),
);

export const trpcClient = createTRPCClient<AppRouter>({ links });

export const api = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
