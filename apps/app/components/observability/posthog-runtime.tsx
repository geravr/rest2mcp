import { useObservabilitySettingsQuery } from "@/hooks/use-observability";
import {
  applyPostHogObservabilitySettings,
  identifyPostHogUser,
  isPostHogEnabled,
  resetPostHogIdentity,
} from "@/lib/posthog";
import { useSessionQuery } from "@/lib/queries/session";
import { useEffect, useEffectEvent, useRef } from "react";

export function PostHogRuntime() {
  const { data: session } = useSessionQuery();
  const { data: observabilitySettings } = useObservabilitySettingsQuery();
  const previousUserIdRef = useRef<string | null>(null);

  const syncObservabilityState = useEffectEvent(() => {
    if (!session?.user || !observabilitySettings) {
      return;
    }

    applyPostHogObservabilitySettings(observabilitySettings);

    if (observabilitySettings.consentStatus !== "granted") {
      return;
    }

    identifyPostHogUser(session.user);
  });

  useEffect(() => {
    if (!isPostHogEnabled()) {
      return;
    }

    const currentUserId = session?.user.id ?? null;
    if (!currentUserId) {
      if (previousUserIdRef.current) {
        resetPostHogIdentity();
        previousUserIdRef.current = null;
      }

      return;
    }

    if (
      previousUserIdRef.current &&
      previousUserIdRef.current !== currentUserId
    ) {
      resetPostHogIdentity();
    }

    previousUserIdRef.current = currentUserId;
  }, [session?.user.id]);

  useEffect(() => {
    if (!isPostHogEnabled() || !session?.user || !observabilitySettings) {
      return;
    }

    syncObservabilityState();
  }, [
    observabilitySettings,
    session?.user.email,
    session?.user.id,
    session?.user.image,
    session?.user.name,
    syncObservabilityState,
  ]);

  return null;
}
