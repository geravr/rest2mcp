import { PostHogProvider } from "@posthog/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@repo/ui";
import { NotFound } from "./components/not-found";
import { PostHogRuntime } from "./components/observability/posthog-runtime";
import {
  getPostHogClient,
  initializePostHogClient,
  isPostHogEnabled,
} from "./lib/posthog";
import { queryClient } from "./lib/query";
import { routeTree } from "./lib/routeTree.gen";
import { initializeTheme } from "./lib/theme";
import "./styles/globals.css";

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultNotFoundComponent: NotFound,
});

initializeTheme();
initializePostHogClient();

function AppToaster() {
  return <Toaster richColors position="bottom-right" />;
}

const container = document.getElementById("root");
const root = createRoot(container!);

const appContent = (
  <>
    <PostHogRuntime />
    <RouterProvider router={router} />
    <AppToaster />
    {import.meta.env.DEV && (
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
    )}
  </>
);

root.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {isPostHogEnabled() ? (
        <PostHogProvider client={getPostHogClient()}>
          {appContent}
        </PostHogProvider>
      ) : (
        appContent
      )}
    </QueryClientProvider>
  </StrictMode>,
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => root.unmount());
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
