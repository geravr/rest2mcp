import * as React from "react";
import "vite/client";

declare global {
  interface Window {
    __posthogInitialized?: boolean;
    dataLayer: unknown[];
  }
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_APP_NAME: string;
  readonly VITE_POSTHOG_BLOCK_SELECTORS?: string;
  readonly VITE_POSTHOG_ERROR_SAMPLE_RATE?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_MASK_TEXT_SELECTORS?: string;
  readonly VITE_POSTHOG_REPLAY_SAMPLE_RATE?: string;
  readonly VITE_POSTHOG_REQUIRE_CONSENT?: string;
  readonly VITE_POSTHOG_TRACE_TARGETS?: string;
}

declare module "*.css";

declare module "*.svg" {
  const content: React.FC<React.SVGProps<SVGElement>>;
  export default content;
}
